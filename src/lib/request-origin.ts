/** Next's internal URL can use localhost even when the browser used 127.0.0.1. */
export function localRequestOrigin(request: Request): string | null {
  try {
    const internal = new URL(request.url);
    const host = request.headers.get('host') || internal.host;
    const actual = new URL(`${internal.protocol}//${host}`);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(actual.hostname) || actual.username || actual.password) return null;
    return actual.origin;
  } catch { return null; }
}

export function localRequestAllowed(request: Request): boolean {
  const actual = localRequestOrigin(request);
  const origin = request.headers.get('origin');
  return !!actual && (!origin || origin === actual);
}

/** Central browser boundary, including legacy routes without their own guard.
 * OAuth GET callbacks retain provider redirects; state + cookie validation is
 * still performed by the callback route. CLI requests have no Fetch Metadata. */
export function apiRequestAllowed(request: Request): boolean {
  if (!localRequestAllowed(request)) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site !== 'cross-site' && site !== 'same-site') return true;
  const url = new URL(request.url);
  return request.method === 'GET' && /^\/api\/integrations\/callback\/(?:google|microsoft)$/.test(url.pathname) &&
    request.headers.get('sec-fetch-mode') === 'navigate';
}
