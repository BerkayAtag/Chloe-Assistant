import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { providerSetup, saveOAuthClient } from '@/lib/oauth-setup';

export async function POST(request: Request) {
  if (!localRequestAllowed(request) || request.headers.get('x-chloe-settings') !== '1') return NextResponse.json({ error: 'Kurulum yalnızca Chloe içinden yapılabilir.' }, { status: 403 });
  try {
    const text = await request.text();
    if (text.length > 8000) throw new Error('Kurulum alanları çok uzun.');
    const input = JSON.parse(text);
    if (!input || !['google', 'microsoft'].includes(input.provider) || typeof input.clientId !== 'string' || typeof input.clientSecret !== 'string') throw new Error('Kurulum alanları geçersiz.');
    saveOAuthClient(input.provider, input.clientId, input.clientSecret);
    const setup = providerSetup(input.provider);
    return NextResponse.json({ configured: setup.configured, missing: setup.missing }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Kurulum kaydedilemedi.' }, { status: 400 });
  }
}
