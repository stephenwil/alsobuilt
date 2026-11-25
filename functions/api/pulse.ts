import type { Env } from '../_lib/env';
import { json } from '../_lib/env';
import { attachBookmark, openSession } from '../_lib/d1';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function computeDedupeHash(request: Request, env: Env, categorySlug: string): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const monthBucket = new Date().toISOString().slice(0, 7);
  const salt = env.PULSE_SALT || 'alsobuilt-default-salt';
  return sha256Hex(`${ip}|${salt}|${categorySlug}|${monthBucket}`);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const handle = openSession(env.PUBLIC_DB, request, 'first-unconstrained');

  const [byCategory, byVariant, totalRow, allCategories] = await Promise.all([
    handle.db
      .prepare('SELECT category_slug, COUNT(*) AS count FROM stealth_pulses GROUP BY category_slug')
      .all<{ category_slug: string; count: number }>(),
    handle.db
      .prepare(
        'SELECT nearest_variant_slug, COUNT(*) AS count FROM stealth_pulses WHERE nearest_variant_slug IS NOT NULL GROUP BY nearest_variant_slug'
      )
      .all<{ nearest_variant_slug: string; count: number }>(),
    handle.db.prepare('SELECT COUNT(*) AS total FROM stealth_pulses').first<{ total: number }>(),
    handle.db.prepare('SELECT slug FROM categories').all<{ slug: string }>()
  ]);

  const categories: Record<string, number> = {};
  for (const row of byCategory.results ?? []) categories[row.category_slug] = row.count;

  const variants: Record<string, number> = {};
  for (const row of byVariant.results ?? []) variants[row.nearest_variant_slug] = row.count;

  const slugs = (allCategories.results ?? []).map((r) => r.slug);
  let myCategories: string[] = [];
  if (slugs.length > 0) {
    const hashes = await Promise.all(slugs.map((slug) => computeDedupeHash(request, env, slug)));
    const placeholders = hashes.map(() => '?').join(', ');
    const mine = await handle.db
      .prepare(`SELECT category_slug FROM stealth_pulses WHERE dedupe_hash IN (${placeholders})`)
      .bind(...hashes)
      .all<{ category_slug: string }>();
    myCategories = (mine.results ?? []).map((r) => r.category_slug);
  }

  return attachBookmark(
    json({
      total: totalRow?.total ?? 0,
      byCategory: categories,
      byVariant: variants,
      myCategories
    }),
    handle
  );
};

function isAllowedWriteOrigin(request: Request): boolean {
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite.toLowerCase() === 'cross-site') {
    return false;
  }
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAllowedWriteOrigin(request)) {
    return json({ error: 'Cross-origin pulse writes are not allowed' }, { status: 403 });
  }

  let body: { categorySlug?: string; nearestVariantSlug?: string | null; traits?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const categorySlug = (body.categorySlug || 'ai-memory').trim().slice(0, 48);
  const nearestVariantSlug = body.nearestVariantSlug ? String(body.nearestVariantSlug).trim().slice(0, 64) : null;
  const traits = Array.isArray(body.traits) ? body.traits.slice(0, 8).map((t) => String(t).slice(0, 32)) : [];

  const region = (request.cf?.country as string | undefined) || 'Global';
  const dedupeHash = await computeDedupeHash(request, env, categorySlug);

  const handle = openSession(env.PUBLIC_DB, request, 'first-primary');

  // Ensure category exists so foreign key constraint always succeeds cleanly
  const cat = await handle.db
    .prepare('SELECT slug FROM categories WHERE slug = ?')
    .bind(categorySlug)
    .first<{ slug: string }>();
  if (!cat) {
    return json({ error: `Unknown category: ${categorySlug}` }, { status: 400 });
  }

  const res = await handle.db
    .prepare(
      `INSERT OR IGNORE INTO stealth_pulses
        (category_slug, nearest_variant_slug, traits_json, region, dedupe_hash)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(categorySlug, nearestVariantSlug, JSON.stringify(traits), region, dedupeHash)
    .run();

  const totalRow = await handle.db
    .prepare('SELECT COUNT(*) AS total FROM stealth_pulses')
    .first<{ total: number }>();

  return attachBookmark(
    json({
      recorded: (res.meta?.changes ?? 0) > 0,
      alreadyCountedThisMonth: (res.meta?.changes ?? 0) === 0,
      total: totalRow?.total ?? 0
    }),
    handle
  );
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAllowedWriteOrigin(request)) {
    return json({ error: 'Cross-origin pulse deletes are not allowed' }, { status: 403 });
  }

  const url = new URL(request.url);
  let categorySlug = url.searchParams.get('categorySlug') || '';

  if (!categorySlug) {
    try {
      const body = (await request.json()) as { categorySlug?: string };
      categorySlug = body.categorySlug || '';
    } catch {
      // ignore empty/non-JSON DELETE bodies
    }
  }

  categorySlug = (categorySlug || 'ai-memory').trim().slice(0, 48);
  const dedupeHash = await computeDedupeHash(request, env, categorySlug);
  const handle = openSession(env.PUBLIC_DB, request, 'first-primary');

  const res = await handle.db
    .prepare('DELETE FROM stealth_pulses WHERE dedupe_hash = ?')
    .bind(dedupeHash)
    .run();

  const totalRow = await handle.db
    .prepare('SELECT COUNT(*) AS total FROM stealth_pulses')
    .first<{ total: number }>();

  return attachBookmark(
    json({
      removed: (res.meta?.changes ?? 0) > 0,
      total: totalRow?.total ?? 0
    }),
    handle
  );
};
