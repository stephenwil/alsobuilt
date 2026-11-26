// Shared same-origin guard for mutating Pages Function endpoints (/api/pulse, /api/event)
export function isAllowedWriteOrigin(request: Request): boolean {
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
