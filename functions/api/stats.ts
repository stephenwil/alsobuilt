import type { Env } from '../_lib/env';
import { json } from '../_lib/env';
import { openSession } from '../_lib/d1';

const EVENTS = ['pageview', 'pitch_search', 'submit_click', 'repo_click', 'compare_open'] as const;
const REFERRER_BUCKETS = ['hn', 'reddit', 'x', 'github', 'direct', 'other'] as const;

interface DailyRow {
  day: string;
  event: string;
  dim: string;
  count: number;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const parsedDays = Number.parseInt(url.searchParams.get('days') || '14', 10);
  const days = Number.isFinite(parsedDays) ? Math.min(90, Math.max(1, parsedDays)) : 14;

  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - (days - 1));
  const since = sinceDate.toISOString().slice(0, 10);

  const handle = openSession(env.PUBLIC_DB, request, 'first-unconstrained');

  const [rowsResult, pulseRow] = await Promise.all([
    handle.db
      .prepare(
        `SELECT day, event, dim, count
         FROM analytics_daily
         WHERE day >= ?
         ORDER BY day DESC, event ASC, dim ASC`
      )
      .bind(since)
      .all<DailyRow>(),
    handle.db.prepare('SELECT COUNT(*) AS total FROM stealth_pulses').first<{ total: number }>()
  ]);

  const totals: Record<string, number> = Object.fromEntries(EVENTS.map((e) => [e, 0]));
  const referrers: Record<string, number> = Object.fromEntries(REFERRER_BUCKETS.map((r) => [r, 0]));
  const byCategory: Record<string, Record<string, number>> = {};

  const dayMap = new Map<
    string,
    {
      day: string;
      events: Record<string, number>;
      referrers: Record<string, number>;
      byDim: Record<string, Record<string, number>>;
    }
  >();

  for (const row of rowsResult.results ?? []) {
    const count = Number(row.count) || 0;
    totals[row.event] = (totals[row.event] ?? 0) + count;

    if (row.event === 'pageview' && row.dim) {
      referrers[row.dim] = (referrers[row.dim] ?? 0) + count;
    } else if (row.dim) {
      if (!byCategory[row.event]) byCategory[row.event] = {};
      byCategory[row.event][row.dim] = (byCategory[row.event][row.dim] ?? 0) + count;
    }

    let entry = dayMap.get(row.day);
    if (!entry) {
      entry = { day: row.day, events: {}, referrers: {}, byDim: {} };
      dayMap.set(row.day, entry);
    }

    entry.events[row.event] = (entry.events[row.event] ?? 0) + count;
    if (row.event === 'pageview' && row.dim) {
      entry.referrers[row.dim] = (entry.referrers[row.dim] ?? 0) + count;
    } else if (row.dim) {
      if (!entry.byDim[row.event]) entry.byDim[row.event] = {};
      entry.byDim[row.event][row.dim] = (entry.byDim[row.event][row.dim] ?? 0) + count;
    }
  }

  return json(
    {
      days,
      since,
      totals,
      referrers,
      byCategory,
      stealthPulses: pulseRow?.total ?? 0,
      daily: [...dayMap.values()]
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=30'
      }
    }
  );
};
