import { NextResponse } from 'next/server';
import { installSkill, listInstalledSkills, previewSkill, removeInstalledSkill } from '@/lib/skills';
import { officeAgents } from '@/lib/office-store';
import { localRequestAllowed } from '@/lib/request-origin';

export async function GET(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Beceri kütüphanesine yalnızca yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  try {
    return NextResponse.json({ skills: listInstalledSkills() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Kurulu beceri kütüphanesi okunamadı.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Beceri işlemleri yalnızca yerel Chloe uygulamasından yapılabilir.' }, { status: 403 });
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Beceri isteği geçersiz.');
    const input = body as Record<string, unknown>;
    if (input.action === 'preview') {
      if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 2000) throw new Error('GitHub skill klasör bağlantısını gir.');
      return NextResponse.json(await previewSkill(input.sourceUrl), { headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.action === 'install') {
      if (typeof input.sourceUrl !== 'string' || input.sourceUrl.length > 2000) throw new Error('GitHub skill klasör bağlantısını gir.');
      if (input.expectedHash !== undefined && typeof input.expectedHash !== 'string') throw new Error('Beceri önizleme karması geçersiz.');
      const skill = await installSkill(input.sourceUrl, input.expectedHash as string | undefined);
      return NextResponse.json({ skill, skills: listInstalledSkills() }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
    }
    if (input.action === 'uninstall') {
      if (typeof input.id !== 'string') throw new Error('Beceri kimliği geçersiz.');
      if (officeAgents().some((agent) => agent.skillIds?.includes(input.id as string))) {
        throw new Error('Bu beceri bir ajana atanmış. Önce ekip ayarlarından atamayı kaldır.');
      }
      removeInstalledSkill(input.id);
      return NextResponse.json({ skills: listInstalledSkills() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    throw new Error('Bilinmeyen beceri işlemi.');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Beceri işlemi başarısız.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
