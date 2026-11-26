import type { Env } from '../_lib/env';
import { json } from '../_lib/env';
import { openSession } from '../_lib/d1';
import { isAllowedWriteOrigin } from '../_lib/origin';

const ALLOWED_EVENTS = new Set([
  'pageview',
  'pitch_search',
  'submit_click',
  'repo_click',
  'compare_open'
]);

const ALLOWED_REFERRER_BUCKETS = new Set([
  'hn',
  'reddit',
  'x',
  'github',
  'direct',
  'other'
]);

const SLUG_RE = /^[a-z0-9-]{1,48}$/;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!isAllowedWriteOrigin(request)) {
    return json({ error: 'Cross-origin event writes are not allowed' }, { status: 403 });
  }

  let body: { event?: unknown; dim?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload' }, { status: 400 });
  }

  const event = typeof body?.event === 'string' ? body.event.trim() : '';
  if (!ALLOWED_EVENTS.has(event)) {
    return json({ error: 'Unknown event type' }, { status: 400 });
  }

  const rawDim = typeof body?.dim === 'string' ? body.dim.trim().toLowerCase() : '';
  const handle = openSession(env.PUBLIC_DB, request, 'first-primary');

  let dim = '';
  if (event === 'pageview') {
    dim = ALLOWED_REFERRER_BUCKETS.has(rawDim) ? rawDim : rawDim ? 'other' : 'direct';
  } else if (rawDim && SLUG_RE.test(rawDim)) {
    // Only persist known category slugs to keep D1 cardinality strictly bounded
    const cat = await handle.db
      .prepare('SELECT slug FROM categories WHERE slug = ?')
      .bind(rawDim)
      .first<{ slug: string }>();
    dim = cat ? cat.slug : '';
  }

  const day = new Date().toISOString().slice(0, 10);

  await handle.db
    .prepare(
      `INSERT INTO analytics_daily (day, event, dim, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(day, event, dim) DO UPDATE SET count = count + 1`
    )
    .bind(day, event, dim)
    .run();

  return json(
    { ok: true },
    {
      headers: {
        'Cache-Control': 'no-store'
      }
    }
  );
};
