import type { Env } from './env';
import { json } from './env';

interface AccessAuthResult {
  ok: true;
  email: string;
}

interface AccessAuthFailure {
  ok: false;
  response: Response;
}

function base64UrlToUint8Array(input: string): Uint8Array<ArrayBuffer> {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isDevLocalOrTailscaleHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.ts.net')) {
    return true;
  }
  const m = hostname.match(/^100\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const second = Number(m[1]);
    return second >= 64 && second <= 127;
  }
  return false;
}

export async function requireVaultAccess(
  request: Request,
  env: Env
): Promise<AccessAuthResult | AccessAuthFailure> {
  const url = new URL(request.url);

  // Local / Tailscale dev convenience bypass (disabled in prod by setting ALLOW_LOCAL_VAULT_BYPASS=false)
  if (isDevLocalOrTailscaleHost(url.hostname) && env.ALLOW_LOCAL_VAULT_BYPASS === 'true') {
    return { ok: true, email: 'local-dev@alsobuilt.local' };
  }

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) {
    return {
      ok: false,
      response: json(
        { error: 'Unauthorized: Cloudflare Access session required for Personal Vault.' },
        { status: 401 }
      )
    };
  }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/$/, '');
  const expectedAud = env.CF_ACCESS_AUD;
  if (!teamDomain || !expectedAud) {
    return {
      ok: false,
      response: json(
        { error: 'Vault auth misconfigured: set CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD secrets.' },
        { status: 500 }
      )
    };
  }

  try {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT');
    const [headerB64, payloadB64, sigB64] = parts;
    const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(headerB64))) as {
      kid?: string;
      alg?: string;
    };
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(payloadB64))) as {
      aud?: string[];
      exp?: number;
      email?: string;
    };

    if (!payload.exp || payload.exp * 1000 < Date.now()) {
      throw new Error('Token expired');
    }
    if (!Array.isArray(payload.aud) || !payload.aud.includes(expectedAud)) {
      throw new Error('Audience mismatch');
    }

    const certsRes = await fetch(`${teamDomain}/cdn-cgi/access/certs`, {
      cf: { cacheTtl: 3600, cacheEverything: true }
    });
    if (!certsRes.ok) throw new Error('Failed to fetch Access JWKS');
    const jwks = (await certsRes.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const jwk = jwks.keys?.find((k) => k.kid === header.kid);
    if (!jwk) throw new Error('Signing key not found');

    const key = await crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlToUint8Array(sigB64),
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    if (!valid) throw new Error('Invalid JWT signature');

    return { ok: true, email: payload.email ?? 'owner' };
  } catch (err) {
    return {
      ok: false,
      response: json(
        { error: `Invalid Cloudflare Access token: ${err instanceof Error ? err.message : 'unknown'}` },
        { status: 403 }
      )
    };
  }
}
