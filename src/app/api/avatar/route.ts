import {
  getAvatarState,
  updateAvatarFromUrl,
  updateAvatarFromQuery,
  resetAvatar,
  cleanupOrphanAvatars,
} from '@/lib/avatar';

// Başlangıç bakımı: yetim özel avatar dosyalarını temizle
cleanupOrphanAvatars();

export async function GET() {
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
