// D1 Sessions API wrapper for global read replication + read-your-writes consistency.
// Falls back cleanly to direct D1Database calls in local environments where withSession is absent.

export interface SessionHandle {
  db: D1Database | D1DatabaseSession;
  getBookmark: () => string | null;
}

export function openSession(
  db: D1Database,
  request: Request,
  defaultMode: 'first-unconstrained' | 'first-primary' = 'first-unconstrained'
): SessionHandle {
  const candidate = db as D1Database & {
    withSession?: (constraintOrBookmark?: string) => D1DatabaseSession;
  };
  if (typeof candidate.withSession === 'function') {
    const bookmark = request.headers.get('x-d1-bookmark') || defaultMode;
    const session = candidate.withSession(bookmark);
    return {
      db: session,
      getBookmark: () => session.getBookmark() ?? null
    };
  }
  return {
    db,
    getBookmark: () => null
  };
}

export function attachBookmark(res: Response, handle: SessionHandle): Response {
  const bm = handle.getBookmark();
  if (bm) res.headers.set('x-d1-bookmark', bm);
  return res;
}
