import { NextResponse, type NextRequest } from 'next/server';
import { apiRequestAllowed } from './lib/request-origin';

export function proxy(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 55 * 1024 * 1024) {
    return NextResponse.json({ error: 'İstek boyutu sınırı aşıldı (55 MB).' }, { status: 413 });
  }
  const response = apiRequestAllowed(request) ? NextResponse.next() : NextResponse.json(
    { error: 'Bu işlem yalnızca aynı yerel Chloe arayüzünden yapılabilir.' }, { status: 403 },
  );
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export const config = { matcher: '/api/:path*' };
