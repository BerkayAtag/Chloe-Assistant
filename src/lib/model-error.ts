import type { Settings } from './settings';

export function modelSecrets(settings: Settings): string[] {
  const profiles = Array.isArray(settings.savedCustomProviders) ? settings.savedCustomProviders : [];
  return [settings.apiKey, settings.jarvisSpeechApiKey, ...(settings.savedApiKeys || []).map((key) => key.apiKey), ...Object.values(settings.builtinConnections || {}).map((p) => p?.apiKey), ...profiles.map((provider) => provider?.apiKey)].filter((key): key is string => typeof key === 'string' && !!key);
}

/** Show provider diagnostics, never request headers or credentials. */
export function modelErrorMessage(error: unknown, secrets: string[] = []): string {
  let message = error instanceof Error ? error.message : String(error);
  const detail = error as { responseBody?: string; statusCode?: number } | null;
  if (typeof detail?.responseBody === 'string') {
    try {
      const response = JSON.parse(detail.responseBody);
      if (typeof response?.error?.message === 'string') message = response.error.message;
    } catch { /* A non-JSON response is not safe/useful to show verbatim. */ }
  }
  for (const secret of [...secrets, process.env.GEMINI_API_KEY, process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY]) {
    if (secret) message = message.split(secret).join('[gizlendi]');
  }
  const hint = /no usable keys|no (?:enabled|available|configured) (?:audio|image|video|speech) (?:providers|models)/i.test(message)
    ? 'Seçili API servisinde bu özellik için kullanılabilir model/anahtar yok. Servisin ses veya medya ayarlarını kontrol et. Başka sağlayıcıya geçilmedi. '
    : detail?.statusCode === 429 || /rate limit|quota exceeded|exceeded.*quota/i.test(message)
    ? 'Sağlayıcının kullanım kotası doldu. Kotanın yenilenmesini bekle veya ayarlardan erişilebilir başka model/anahtar seç. Otomatik ücretli yükseltme yapılmadı. '
    : detail?.statusCode === 503 || /high demand|overloaded|temporarily unavailable/i.test(message)
    ? 'Sağlayıcı geçici olarak yoğun veya kullanılamıyor. Anahtarın silinmedi; başka sağlayıcıya geçilmedi. Biraz sonra yeniden dene veya aynı sağlayıcıdan başka model seç. '
    : /ECONNREFUSED|fetch failed/i.test(message)
    ? 'API servisine erişilemiyor. FreeLLMAPI/Ollama gibi yerel bir servis kullanıyorsan uygulamanın açık ve adresin doğru olduğunu kontrol et. Anahtarın korunuyor. '
    : '';
  return `${hint}${message}${detail?.statusCode ? ` (HTTP ${detail.statusCode})` : ''}`;
}
