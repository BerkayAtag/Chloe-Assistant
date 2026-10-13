import { NextResponse } from 'next/server';
import { DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { localRequestAllowed } from '@/lib/request-origin';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { readLimitedBytes } from '@/lib/media-provider';

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Model listesi Chloe içinden istenmeli.' }, { status: 403 });
  let settings = DEFAULT_SETTINGS;
  try {
    const body = await request.json();
    if (!hasExplicitConnection(body?.settings)) throw new Error('Önce sağlayıcı seç.');
    settings = { ...DEFAULT_SETTINGS, ...body.settings } as Settings;
    if (settings.provider !== 'cloud') throw new Error('Yerel modeller için Ollama listesini kullan.');
    const key = settings.apiKey.trim(); if (!key) throw new Error('Önce kayıtlı API anahtarını seç.');
    const google = settings.cloudProvider === 'gemini';
    const base = google ? 'https://generativelanguage.googleapis.com/v1beta' : settings.cloudProvider === 'openai' ? 'https://api.openai.com/v1' : settings.cloudProvider === 'custom' ? settings.apiBaseUrl : '';
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('API adresi geçersiz.');
    url.pathname = url.pathname.replace(/\/+$/, '') + '/models';
    if (settings.cloudProvider === 'custom' && /freellm/i.test(settings.customProviderName)) url.searchParams.set('available', 'true');
    const response = await fetch(url, { headers: google ? { 'x-goog-api-key': key } : { Authorization: `Bearer ${key}` },
      redirect: 'error', cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(12000)]) });
    const data = JSON.parse(new TextDecoder().decode(await readLimitedBytes(response, 4 * 1024 * 1024)));
    if (!response.ok) throw Object.assign(new Error(typeof data.error?.message === 'string' ? data.error.message : 'Model listesi alınamadı.'), { statusCode: response.status });
    const rows = google ? data.models : data.data;
    if (!Array.isArray(rows)) throw new Error('Sağlayıcının model listesi beklenen biçimde değil.');
    const models: string[] = [...new Set<string>(rows.map((row) => google ? row.name?.replace(/^models\//, '') : row.id).filter((id): id is string => typeof id === 'string' && id.length <= 200))].sort();
    return NextResponse.json({ models }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: modelErrorMessage(error, modelSecrets(settings)) }, { status: 502 }); }
}
