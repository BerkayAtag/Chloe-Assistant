import { NextResponse } from 'next/server';
import { readConnections, writeConnections } from '@/lib/connection-store';
import { localRequestAllowed } from '@/lib/request-origin';

const headers = { 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' };
function allowed(request: Request) {
  return localRequestAllowed(request) && request.headers.get('x-chloe-settings') === '1' &&
    !['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '');
}
function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Kasa kaydı başarısız.';
  const conflict = message === 'CONFLICT';
  return NextResponse.json({ error: conflict ? 'Bağlantı başka bir pencerede değişti. Yeniden dene; eski anahtarlar korunuyor.' : message }, { status: conflict ? 409 : 503, headers });
}
export async function GET(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: 'Kasa yalnızca bu cihazdaki Chloe arayüzünden açılabilir.' }, { status: 403, headers });
  try { return NextResponse.json(readConnections(), { headers }); } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!allowed(request)) return NextResponse.json({ error: 'Kasa erişimi reddedildi.' }, { status: 403, headers });
  try {
    const raw = await request.text();
    if (raw.length > 256_000) return NextResponse.json({ error: 'Kayıt çok büyük.' }, { status: 413, headers });
    const body = JSON.parse(raw);
    if (!body || !['migrate', 'save'].includes(body.action) || (body.action === 'save' && !Number.isSafeInteger(body.revision))) return NextResponse.json({ error: 'Geçersiz kasa işlemi.' }, { status: 400, headers });
    return NextResponse.json(writeConnections(body.patch, { migration: body.action === 'migrate', revision: body.action === 'save' ? body.revision : undefined }), { headers });
  } catch (error) { return errorResponse(error); }
}
