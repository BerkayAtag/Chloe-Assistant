import { NextResponse } from 'next/server';
import { searchSkillCatalog, type SkillCatalogSource } from '@/lib/skills';
import { localRequestAllowed } from '@/lib/request-origin';

export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Beceri kataloğu yalnızca yerel Chloe uygulamasından kullanılabilir.' }, { status: 403 });
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const query = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (source !== 'ai-skills' && source !== 'ai-hero' && source !== 'standard') {
    return NextResponse.json({ error: 'Bilinmeyen beceri kataloğu.' }, { status: 400 });
  }
  if (source === 'standard') {
    return NextResponse.json({
      skills: [],
      message: 'Agent Skills, SKILL.md biçim standardıdır; merkezi bir beceri kataloğu sunmaz. Standartla uyumlu GitHub beceri klasörünü aşağıdaki bağlantı alanından içe aktar.',
    });
  }
  try {
    const skills = await searchSkillCatalog(source as SkillCatalogSource, query);
    return NextResponse.json({ skills }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Beceri kataloğu alınamadı.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
