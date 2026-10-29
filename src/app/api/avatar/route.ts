import {
  getAvatarState,
  updateAvatarFromUrl,
  updateAvatarFromQuery,
  resetAvatar,
  cleanupOrphanAvatars,
  readCustomAvatar,
} from '@/lib/avatar';

// Başlangıç bakımı: yetim özel avatar dosyalarını temizle
cleanupOrphanAvatars();

export async function GET(req: Request) {
  // ?image=1 → özel görselin kendisi (üretim sunucusu sonradan eklenen public dosyalarını sunmaz)
  if (new URL(req.url).searchParams.has('image')) {
    const image = readCustomAvatar();
    if (!image) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(image.buffer), { headers: { 'Content-Type': image.contentType, 'Cache-Control': 'no-store' } });
  }
  try {
    const state = getAvatarState();
    return Response.json({ success: true, data: state });
  } catch {
    return Response.json({
      success: true,
      data: { file: null, version: 0, updatedAt: '' },
    });
  }
}

/** Manuel avatar güncelleme: { url } veya { query } */
export async function POST(req: Request) {
  try {
    const { url, query } = await req.json();
    const state = url
      ? await updateAvatarFromUrl(url)
      : query
        ? await updateAvatarFromQuery(query)
        : resetAvatar();
    return Response.json({ success: true, data: state });
  } catch (e: unknown) {
    return Response.json(
      { error: e instanceof Error ? e.message : 'Avatar güncellenemedi.' },
      { status: 400 }
    );
  }
}
