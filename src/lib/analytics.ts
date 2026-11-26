export type FunnelEvent = 'pageview' | 'pitch_search' | 'submit_click' | 'repo_click' | 'compare_open';
export type ReferrerBucket = 'hn' | 'reddit' | 'x' | 'github' | 'direct' | 'other';

export function bucketReferrer(referrer: string, currentHost?: string): ReferrerBucket {
  if (!referrer) return 'direct';
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return 'other';
  }
  if (!host) return 'direct';
  if (currentHost && host === currentHost.toLowerCase()) return 'direct';
  if (host === 'news.ycombinator.com' || host.endsWith('.ycombinator.com') || host === 'hckrnews.com') {
    return 'hn';
  }
  if (host === 'reddit.com' || host.endsWith('.reddit.com') || host === 'redd.it') {
    return 'reddit';
  }
  if (host === 't.co' || host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
    return 'x';
  }
  if (host === 'github.com' || host.endsWith('.github.com') || host === 'github.io' || host.endsWith('.github.io')) {
    return 'github';
  }
  return 'other';
}

export function trackEvent(event: FunnelEvent, dim = ''): void {
  if (typeof window === 'undefined') return;
  try {
    const payload = JSON.stringify({ event, dim });
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const queued = navigator.sendBeacon('/api/event', new Blob([payload], { type: 'application/json' }));
      if (queued) return;
    }
    void fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  } catch {
    // Silent failure: analytics must never disrupt UX
  }
}
