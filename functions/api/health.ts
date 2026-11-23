import type { Env } from '../_lib/env';
import { json } from '../_lib/env';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const checks = { publicDb: false, vaultDb: false };
  try {
    await env.PUBLIC_DB.prepare('SELECT 1 AS ok').first();
    checks.publicDb = true;
  } catch {
    checks.publicDb = false;
  }
  try {
    await env.VAULT_DB.prepare('SELECT 1 AS ok').first();
    checks.vaultDb = true;
  } catch {
    checks.vaultDb = false;
  }

  return json({
    ok: checks.publicDb && checks.vaultDb,
    service: 'alsobuilt',
    databases: checks
  });
};
