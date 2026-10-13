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
