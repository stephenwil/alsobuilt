import type { Env } from '../../../_lib/env';
import { json } from '../../../_lib/env';
import { requireVaultAccess } from '../../../_lib/access';
import { attachBookmark, openSession } from '../../../_lib/d1';

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireVaultAccess(request, env);
  if (!auth.ok) return auth.response;

  const id = String(params.id || '').trim();
  if (!id) return json({ error: 'Missing idea id' }, { status: 400 });

  let body: {
    title?: string;
    pitch?: string;
    categorySlug?: string;
    traits?: string[];
    status?: string;
    conviction?: number;
    privateNotes?: string;
    wedgeNotes?: string;
    lastMaxOverlap?: number | null;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const handle = openSession(env.VAULT_DB, request, 'first-primary');
  const existing = await handle.db
    .prepare('SELECT * FROM personal_ideas WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return json({ error: 'Idea not found' }, { status: 404 });

  const title = body.title !== undefined ? String(body.title).trim().slice(0, 100) : String(existing.title);
  const pitch = body.pitch !== undefined ? String(body.pitch).trim().slice(0, 600) : String(existing.pitch);
  const categorySlug =
    body.categorySlug !== undefined ? String(body.categorySlug).trim().slice(0, 48) : String(existing.category_slug);
  const traitsJson =
    body.traits !== undefined
      ? JSON.stringify(body.traits.slice(0, 10).map((t) => String(t).slice(0, 32)))
      : String(existing.traits_json);
  const allowedStatus = new Set(['spark', 'researching', 'building', 'parked', 'shipped']);
  const status =
    body.status && allowedStatus.has(body.status) ? body.status : String(existing.status);
  const conviction =
    body.conviction !== undefined
      ? Math.max(1, Math.min(5, Math.round(Number(body.conviction))))
      : Number(existing.conviction);
  const privateNotes =
    body.privateNotes !== undefined ? String(body.privateNotes).slice(0, 4000) : String(existing.private_notes);
  const wedgeNotes =
    body.wedgeNotes !== undefined ? String(body.wedgeNotes).slice(0, 1000) : String(existing.wedge_notes);
  const lastMaxOverlap =
    body.lastMaxOverlap !== undefined ? body.lastMaxOverlap : (existing.last_max_overlap as number | null);

  await handle.db
    .prepare(
      `UPDATE personal_ideas
       SET title = ?, pitch = ?, category_slug = ?, traits_json = ?, status = ?,
           conviction = ?, private_notes = ?, wedge_notes = ?, last_max_overlap = ?,
           last_checked_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`
    )
    .bind(
      title,
      pitch,
      categorySlug,
      traitsJson,
      status,
      conviction,
      privateNotes,
      wedgeNotes,
      lastMaxOverlap,
      id
    )
    .run();

  return attachBookmark(json({ id, updated: true }), handle);
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireVaultAccess(request, env);
  if (!auth.ok) return auth.response;

  const id = String(params.id || '').trim();
  const handle = openSession(env.VAULT_DB, request, 'first-primary');
  const res = await handle.db.prepare('DELETE FROM personal_ideas WHERE id = ?').bind(id).run();
  return attachBookmark(json({ id, deleted: (res.meta?.changes ?? 0) > 0 }), handle);
};

// POST /api/vault/ideas/:id records a collision snapshot so you can track crowding over time
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const auth = await requireVaultAccess(request, env);
  if (!auth.ok) return auth.response;

  const id = String(params.id || '').trim();
  let body: {
    topOverlap?: number;
    closestSlug?: string | null;
    publicTwinsCount?: number;
    stealthNearbyCount?: number;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const topOverlap = Math.max(0, Math.min(100, Math.round(Number(body.topOverlap ?? 0))));
  const closestSlug = body.closestSlug ? String(body.closestSlug).slice(0, 64) : null;
  const publicTwinsCount = Math.max(0, Math.round(Number(body.publicTwinsCount ?? 0)));
  const stealthNearbyCount = Math.max(0, Math.round(Number(body.stealthNearbyCount ?? 0)));

  const handle = openSession(env.VAULT_DB, request, 'first-primary');
  await handle.db.batch([
    handle.db
      .prepare(
        `INSERT INTO collision_snapshots
          (idea_id, top_overlap, closest_slug, public_twins_count, stealth_nearby_count)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, topOverlap, closestSlug, publicTwinsCount, stealthNearbyCount),
    handle.db
      .prepare(
        `UPDATE personal_ideas
         SET last_max_overlap = ?, last_checked_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?`
      )
      .bind(topOverlap, id)
  ]);

  return attachBookmark(json({ id, snapshotSaved: true, topOverlap }, { status: 201 }), handle);
};
