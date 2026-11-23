import type { Env } from '../_lib/env';
import { json } from '../_lib/env';
import { attachBookmark, openSession } from '../_lib/d1';

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const handle = openSession(env.PUBLIC_DB, request, 'first-unconstrained');

  const [byCategory, byVariant, totalRow] = await Promise.all([
    handle.db
      .prepare('SELECT category_slug, COUNT(*) AS count FROM stealth_pulses GROUP BY category_slug')
      .all<{ category_slug: string; count: number }>(),
    handle.db
      .prepare(
        'SELECT nearest_variant_slug, COUNT(*) AS count FROM stealth_pulses WHERE nearest_variant_slug IS NOT NULL GROUP BY nearest_variant_slug'
      )
      .all<{ nearest_variant_slug: string; count: number }>(),
    handle.db.prepare('SELECT COUNT(*) AS total FROM stealth_pulses').first<{ total: number }>()
  ]);

  const categories: Record<string, number> = {};
  for (const row of byCategory.results ?? []) categories[row.category_slug] = row.count;

  const variants: Record<string, number> = {};
  for (const row of byVariant.results ?? []) variants[row.nearest_variant_slug] = row.count;

  return attachBookmark(
    json({
      total: totalRow?.total ?? 0,
      byCategory: categories,
      byVariant: variants
    }),
    handle
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: { categorySlug?: string; nearestVariantSlug?: string | null; traits?: string[] };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const categorySlug = (body.categorySlug || 'ai-memory').trim().slice(0, 48);
  const nearestVariantSlug = body.nearestVariantSlug ? String(body.nearestVariantSlug).trim().slice(0, 64) : null;
  const traits = Array.isArray(body.traits) ? body.traits.slice(0, 8).map((t) => String(t).slice(0, 32)) : [];

  const ip = request.headers.get('CF-Connecting-IP') || '127.0.0.1';
  const region = (request.cf?.country as string | undefined) || 'Global';
  const monthBucket = new Date().toISOString().slice(0, 7);
  const salt = env.PULSE_SALT || 'alsobuilt-default-salt';
  const dedupeHash = await sha256Hex(`${ip}|${salt}|${categorySlug}|${monthBucket}`);

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
