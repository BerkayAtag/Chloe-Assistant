import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { listWorkspaceEntries, readWorkspaceFile, saveWorkspaceFile, WorkspaceError } from '@/lib/codex-workspace';

const MAX_REQUEST_SIZE = 600_000;

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Proje dosyalarına yalnızca Chloe içinden erişilebilir.' }, { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > MAX_REQUEST_SIZE) return NextResponse.json({ error: 'İstek boyutu sınırı aşıldı.' }, { status: 413 });
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_REQUEST_SIZE) return NextResponse.json({ error: 'İstek boyutu sınırı aşıldı.' }, { status: 413 });
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'İstek biçimi geçersiz.' }, { status: 400 });
    const input = body as Record<string, unknown>;
    if (typeof input.workspace !== 'string') return NextResponse.json({ error: 'Proje klasörü belirtilmedi.' }, { status: 400 });
    switch (input.action) {
      case 'list':
        return NextResponse.json(listWorkspaceEntries(input.workspace), { headers: { 'Cache-Control': 'no-store' } });
      case 'read':
        if (typeof input.path !== 'string') return NextResponse.json({ error: 'Dosya yolu belirtilmedi.' }, { status: 400 });
        return NextResponse.json(readWorkspaceFile(input.workspace, input.path), { headers: { 'Cache-Control': 'no-store' } });
      case 'save':
        if (typeof input.path !== 'string' || typeof input.source !== 'string' || typeof input.expectedHash !== 'string') {
          return NextResponse.json({ error: 'Kaydetme alanları geçersiz.' }, { status: 400 });
        }
        return NextResponse.json(saveWorkspaceFile(input.workspace, input.path, input.source, input.expectedHash));
      default:
        return NextResponse.json({ error: 'Geçersiz proje işlemi.' }, { status: 400 });
    }
  } catch (error) {
    const status = error instanceof WorkspaceError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Proje işlemi başarısız oldu.' }, { status });
  }
}
