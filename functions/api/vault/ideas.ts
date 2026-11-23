import type { Env } from '../../_lib/env';
import { json } from '../../_lib/env';
import { requireVaultAccess } from '../../_lib/access';
import { attachBookmark, openSession } from '../../_lib/d1';

interface PersonalIdeaRow {
  id: string;
  title: string;
  pitch: string;
  category_slug: string;
  traits_json: string;
  status: string;
  conviction: number;
  private_notes: string;
  wedge_notes: string;
  last_max_overlap: number | null;
  last_checked_at: string | null;
  promoted_slug: string | null;
  created_at: string;
  updated_at: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireVaultAccess(request, env);
  if (!auth.ok) return auth.response;

  const handle = openSession(env.VAULT_DB, request, 'first-primary');
  const { results } = await handle.db
    .prepare('SELECT * FROM personal_ideas ORDER BY updated_at DESC')
    .all<PersonalIdeaRow>();

  const ideas = (results ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    pitch: r.pitch,
    categorySlug: r.category_slug,
    traits: JSON.parse(r.traits_json || '[]') as string[],
    status: r.status,
    conviction: r.conviction,
    privateNotes: r.private_notes,
    wedgeNotes: r.wedge_notes,
    lastMaxOverlap: r.last_max_overlap,
    lastCheckedAt: r.last_checked_at,
    promotedSlug: r.promoted_slug,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));

  return attachBookmark(json({ owner: auth.email, ideas }), handle);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const auth = await requireVaultAccess(request, env);
  if (!auth.ok) return auth.response;

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

  const title = (body.title || '').trim().slice(0, 100);
  const pitch = (body.pitch || '').trim().slice(0, 600);
  if (!title || !pitch) {
    return json({ error: 'Both title and pitch are required.' }, { status: 400 });
  }

  const id = crypto.randomUUID();
  const categorySlug = (body.categorySlug || 'ai-memory').trim().slice(0, 48);
  const traits = Array.isArray(body.traits) ? body.traits.slice(0, 10).map((t) => String(t).slice(0, 32)) : [];
  const allowedStatus = new Set(['spark', 'researching', 'building', 'parked', 'shipped']);
  const status = allowedStatus.has(body.status || '') ? (body.status as string) : 'spark';
  const conviction = Math.max(1, Math.min(5, Math.round(Number(body.conviction ?? 3))));
  const privateNotes = String(body.privateNotes ?? '').slice(0, 4000);
  const wedgeNotes = String(body.wedgeNotes ?? '').slice(0, 1000);
  const lastMaxOverlap = typeof body.lastMaxOverlap === 'number' ? Math.round(body.lastMaxOverlap) : null;

  const handle = openSession(env.VAULT_DB, request, 'first-primary');
  await handle.db
    .prepare(
      `INSERT INTO personal_ideas
        (id, title, pitch, category_slug, traits_json, status, conviction, private_notes, wedge_notes, last_max_overlap, last_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      id,
      title,
      pitch,
      categorySlug,
      JSON.stringify(traits),
      status,
      conviction,
      privateNotes,
      wedgeNotes,
      lastMaxOverlap
    )
    .run();

  return attachBookmark(json({ id, created: true }, { status: 201 }), handle);
};
