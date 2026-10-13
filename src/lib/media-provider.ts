import type { Settings } from './settings';

export type MediaKind = 'speech' | 'image' | 'video';
export class MediaConfigurationError extends Error {}

/** No fallback across providers, including when a key is missing or rejected. */
export function mediaConnection(settings: Settings, kind: MediaKind, geminiEnvironmentKey = '') {
  if (settings.provider !== 'cloud' || !['gemini', 'custom'].includes(settings.cloudProvider)) {
    throw new MediaConfigurationError('Seçili sağlayıcının bu ses/medya bağlantısı desteklenmiyor. Gemini veya başka bir servise otomatik geçilmedi. Ses için cihaz sesini seçebilir; medya için destekleyen bir API bağlantısı kullanabilirsin.');
  }
  if (settings.cloudProvider === 'gemini') {
    const key = settings.apiKey?.trim() || geminiEnvironmentKey;
    if (!key) throw new MediaConfigurationError('Seçili Gemini bağlantısının API anahtarı eksik. Ana model ayarlarından ekle.');
    return { adapter: 'gemini' as const, name: 'Gemini', key, baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: { speech: 'gemini-3.8-flash-tts', image: 'gemini-nano-banana-2.1', video: 'veo-3.1-generate-preview' }[kind] };
  }
  const key = settings.apiKey?.trim();
  if (!key) throw new MediaConfigurationError('Seçili API bağlantısının anahtarı eksik. Başka bir anahtar kullanılmadı.');
  let url: URL;
  try { url = new URL(settings.apiBaseUrl); } catch { throw new MediaConfigurationError('Seçili API adresi geçersiz.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new MediaConfigurationError('API adresi HTTP/HTTPS olmalı; kimlik bilgisi, sorgu veya # içermemeli.');
  const model = { speech: settings.customSpeechModel, image: settings.customImageModel, video: settings.customVideoModel }[kind]?.trim() || 'auto';
  return { adapter: 'compatible' as const, name: settings.customProviderName?.trim() || 'Özel API', key, baseUrl: url.href.replace(/\/+$/, ''), model };
}

export async function readLimitedBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Sağlayıcı boş yanıt verdi.');
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new Error('Üretilen dosya boyut sınırını aştı.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error('Sağlayıcı boş dosya döndürdü.');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function providerFailure(response: Response, name: string): Promise<Error> {
  let message = `${name} isteği başarısız.`;
  try {
    const data = JSON.parse(new TextDecoder().decode(await readLimitedBytes(response, 128 * 1024)));
    if (typeof data.error?.message === 'string') message = data.error.message;
    else if (typeof data.error === 'string') message = data.error;
    else if (typeof data.message === 'string') message = data.message;
  } catch { /* HTML/proxy responses can contain secrets; never show raw bodies. */ }
  if ([404, 405, 501].includes(response.status)) message = `${name} bu ses/medya uç noktasını sunmuyor. Başka sağlayıcıya geçilmedi. ${message}`;
  return Object.assign(new Error(message), { statusCode: response.status });
}
