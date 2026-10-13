import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return new Response('Geçersiz dosya.', { status: 400 });
  try {
    const dir = path.join(process.cwd(), 'data', 'uploads');
    const name = (await readdir(dir)).find((item) => item.startsWith(id + '-'));
    if (!name) return new Response('Dosya bulunamadı.', { status: 404 });
    const ext = path.extname(name).toLowerCase();
    if (ext === '.gif' || ext === '.doc') {
      return new Response(await readFile(path.join(dir, name)), { headers: {
        'Content-Type': ext === '.gif' ? 'image/gif' : 'application/msword',
        'Cache-Control': 'private, max-age=3600',
      } });
    }
    const type = ext === '.pdf' ? 'application/pdf' : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.mp4' ? 'video/mp4' : 'application/octet-stream';
    return new Response(await readFile(path.join(dir, name)), { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' } });
  } catch { return new Response('Dosya bulunamadı.', { status: 404 }); }
}
