import { generateText } from 'ai';
import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/llm-provider';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { activeCustomProvider, DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { localRequestAllowed } from '@/lib/request-origin';

export const maxDuration = 30;

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Bağlantı testi bu uygulamadan yapılmalı.' }, { status: 403 });
  let body: { settings?: Partial<Settings> } | null;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalı.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'İstek ayarlarını içeren bir nesne olmalı.' }, { status: 400 });
  }

  if (!hasExplicitConnection(body.settings)) return NextResponse.json({ error: 'Etkin AI sağlayıcısını ayarlardan seç. Varsayılan sağlayıcıya otomatik geçilmedi.' }, { status: 400 });
  const settings: Settings = { ...DEFAULT_SETTINGS, ...(body.settings || {}) };
  const customProvider = settings.cloudProvider === 'custom'
    ? activeCustomProvider(settings)
    : null;
  let model;
  try {
    model = getProvider(settings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Model ayarları geçersiz.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const timeout = AbortSignal.timeout(20_000);
  try {
    const result = await generateText({
      model,
      prompt: 'Bağlantı testi. Yalnızca OK yaz.',
      maxOutputTokens: 512,
      maxRetries: 0,
      abortSignal: AbortSignal.any([timeout, request.signal]),
    });
    if (!result.text.trim()) {
      throw new Error('Model boş yanıt verdi. Model kimliğini ve metin üretim desteğini kontrol et.');
    }
    return NextResponse.json({
      success: true,
      provider: settings.provider === 'local'
        ? 'Local LLM'
        : settings.cloudProvider === 'custom'
          ? customProvider?.name || settings.customProviderName.trim() || 'Diğer API'
          : settings.cloudProvider,
      model: settings.provider === 'local'
        ? settings.ollamaModel
        : settings.cloudProvider === 'custom'
          ? customProvider?.model || settings.customModel
          : settings.cloudModel,
      response: result.text.trim(),
    });
  } catch (error: unknown) {
    const message = modelErrorMessage(error, modelSecrets(settings));
    const timedOut = timeout.aborted;
    return NextResponse.json(
      { error: timedOut ? 'Model yanıt vermedi (20 saniye zaman aşımı).' : message },
      { status: 502 }
    );
  }
}
