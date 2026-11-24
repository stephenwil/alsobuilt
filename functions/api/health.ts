import type { Env } from '../_lib/env';
import { json } from '../_lib/env';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  let publicDb = false;
  try {
    await env.PUBLIC_DB.prepare('SELECT 1 AS ok').first();
    publicDb = true;
  } catch {
    publicDb = false;
  }

  return json({
    ok: publicDb,
    service: 'alsobuilt',
    databases: { publicDb }
  });
};
