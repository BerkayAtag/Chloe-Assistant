import type { Settings } from './settings';
import { CLOUD_MODEL_SUGGESTIONS } from './settings.ts';

/** FreeLLMAPI's documented fast router, for voice turns only. Never change keys,
 *  endpoints, explicit model choices, team settings, or unsupported providers. */
export function jarvisModelSettings(settings: Settings): Settings {
  if (!settings.jarvisMode || settings.jarvisFastMode === false) return settings;
  const fast = { ...settings, thinkingMode: 'fast' as const };
  try {
    const endpoint = new URL(settings.apiBaseUrl);
    const isFreeLLM = /freellm/i.test(settings.customProviderName) || /freellm/i.test(endpoint.hostname);
    const isPort31415 = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) && endpoint.port === '31415';
    const isFreeLLMHost = endpoint.hostname.toLowerCase().includes('freellm');
    if (settings.provider === 'cloud' && settings.cloudProvider === 'custom' &&
        isFreeLLM && settings.customModel === 'auto' &&
        (isPort31415 || isFreeLLMHost)) {
      return { ...fast, customModel: 'auto:fast' };
    }
  } catch { /* Provider validation retains the original explicit error. */ }
  return fast;
}

/**
 * Jarvis'e özel sağlayıcı seçildiğinde anahtarı çözer.
 * ÖNEMLİ: Bu fonksiyon **asla fırlatmaz** — ayarlar render sırasında da okunur
 * (model etiketi). Eksik anahtar durumunda `null` döner ve çağıran taraf ana
 * bağlantıya düşer; sorun `jarvisModelIssue` ile kullanıcıya bildirilir.
 */
function jarvisKey(settings: Settings, provider: 'gemini' | 'openai' | 'anthropic'): string | null {
  const dedicated = settings.jarvisApiKey?.trim();
  if (dedicated) return dedicated;
  const mainKey = settings.apiKey?.trim();
  // Aynı sağlayıcıdaki ana anahtar güvenle kullanılabilir; FARKLI sağlayıcıya
  // ana anahtar göndermek yanıltıcı 400 hataları üretir, bu yüzden kullanılmaz.
  if (settings.provider === 'cloud' && settings.cloudProvider === provider && mainKey) return mainKey;
  return null;
}

const PROVIDER_LABEL: Record<string, string> = { gemini: 'Gemini', openai: 'OpenAI', anthropic: 'Anthropic', custom: 'Özel API' };

/** Jarvis'e özel bağlantı eksikse kullanıcıya gösterilecek uyarı (yoksa null). */
export function jarvisModelIssue(settings: Settings): string | null {
  if (!settings.jarvisMode) return null;
  const provider = settings.jarvisProvider || 'inherit';
  if (provider === 'inherit' || provider === 'local') return null;
  if (provider === 'custom') {
    const dedicated = settings.jarvisApiKey?.trim();
    const jarvisBase = settings.jarvisApiBaseUrl?.trim() || '';
    const mainKey = settings.apiKey?.trim();
    const sameEndpoint = !jarvisBase || jarvisBase.replace(/\/+$/, '') === (settings.apiBaseUrl || '').replace(/\/+$/, '');
    if (dedicated || (settings.provider === 'cloud' && settings.cloudProvider === 'custom' && sameEndpoint && mainKey)) return null;
    return 'Jarvis için özel API anahtarı girilmedi; şimdilik ana bağlantı kullanılıyor.';
  }
  if (!jarvisKey(settings, provider as 'gemini' | 'openai' | 'anthropic')) {
    return `Jarvis için ${PROVIDER_LABEL[provider] || provider} API anahtarı girilmedi; şimdilik ana bağlantı kullanılıyor.`;
  }
  return null;
}

/** Resolves the effective active connection for Jarvis mode.
 *  When a dedicated Jarvis provider/key is configured it is used for fast voice
 *  turns. Otherwise the main connection is used (with FreeLLMAPI fast routing).
 *  Never throws: eksik anahtar sessizce ana bağlantıya düşer. */
export function jarvisEffectiveSettings(settings: Settings): Settings {
  if (!settings.jarvisMode) return settings;

  const jarvisProvider = settings.jarvisProvider || 'inherit';
  if (jarvisProvider !== 'inherit') {
    const fastThinking = settings.jarvisFastMode !== false ? ('fast' as const) : settings.thinkingMode;
    if (jarvisProvider === 'local') {
      return {
        ...settings,
        provider: 'local',
        ollamaUrl: settings.jarvisApiBaseUrl?.trim() || settings.ollamaUrl || 'http://127.0.0.1:11434/v1',
        ollamaModel: settings.jarvisModel?.trim() || settings.ollamaModel || 'llama3.2:1b',
        thinkingMode: fastThinking,
      };
    }
    if (jarvisProvider === 'gemini' || jarvisProvider === 'openai' || jarvisProvider === 'anthropic') {
      const key = jarvisKey(settings, jarvisProvider);
      if (key) {
        return {
          ...settings,
          provider: 'cloud',
          cloudProvider: jarvisProvider,
          apiKey: key,
          cloudModel: settings.jarvisModel?.trim() || (settings.cloudProvider === jarvisProvider
            ? settings.cloudModel : CLOUD_MODEL_SUGGESTIONS[jarvisProvider][0]),
          thinkingMode: fastThinking,
        };
      }
      // Anahtar yok → çökme yok, ana bağlantı korunur (uyarı arayüzde gösterilir).
      return jarvisModelSettings(settings);
    }
    if (jarvisProvider === 'custom') {
      const dedicated = settings.jarvisApiKey?.trim();
      const jarvisBase = settings.jarvisApiBaseUrl?.trim() || '';
      const mainKey = settings.apiKey?.trim();
      const sameEndpoint = !jarvisBase || jarvisBase.replace(/\/+$/, '') === (settings.apiBaseUrl || '').replace(/\/+$/, '');
      const key = dedicated || (settings.provider === 'cloud' && settings.cloudProvider === 'custom' && sameEndpoint ? mainKey : '');
      if (key) {
        return {
          ...settings,
          provider: 'cloud',
          cloudProvider: 'custom',
          apiKey: key,
          apiBaseUrl: jarvisBase || settings.apiBaseUrl,
          customModel: settings.jarvisModel?.trim() || settings.customModel || 'auto',
          customProviderName: jarvisBase && !sameEndpoint ? 'Jarvis Özel API' : settings.customProviderName,
          customSupportsTools: true,
          thinkingMode: fastThinking,
        };
      }
      return jarvisModelSettings(settings);
    }
  }

  return jarvisModelSettings(settings);
}

export interface SpeechResolution {
  /** Ses üretimi için kullanılacak ayarlar. */
  settings: Settings;
  /** Ses için AYRI bağlantı mı kullanılıyor? */
  dedicated: boolean;
  /** Ses üretilemiyorsa kullanıcıya gösterilecek açıklama. */
  issue: string | null;
}

const SPEECH_CAPABLE = (settings: Settings) =>
  settings.provider === 'cloud' && ['gemini', 'custom'].includes(settings.cloudProvider);

/**
 * SES (TTS) bağlantısını çözer. Öncelik sırası:
 *  1) Jarvis konsolunda tanımlı **ses için ayrı API** (jarvisSpeechProvider)
 *  2) Jarvis'e özel LLM bağlantısı (ses üretebiliyorsa)
 *  3) Ana bağlantı (ses üretebiliyorsa)
 * Hiçbiri ses üretemiyorsa net bir açıklama döner; asla fırlatmaz.
 */
export function jarvisSpeechSettings(settings: Settings): SpeechResolution {
  const dedicatedProvider = settings.jarvisSpeechProvider || 'inherit';
  const dedicatedKey = settings.jarvisSpeechApiKey?.trim();

  if (dedicatedProvider === 'gemini') {
    if (!dedicatedKey) {
      return { settings, dedicated: false, issue: 'Ses için ayrı Gemini anahtarı girilmedi.' };
    }
    return {
      settings: { ...settings, provider: 'cloud', cloudProvider: 'gemini', apiKey: dedicatedKey },
      dedicated: true,
      issue: null,
    };
  }

  if (dedicatedProvider === 'custom') {
    const base = settings.jarvisSpeechApiBaseUrl?.trim();
    if (!dedicatedKey || !base) {
      return { settings, dedicated: false, issue: 'Ses için ayrı API adresi ve anahtarı girilmedi.' };
    }
    return {
      settings: { ...settings, provider: 'cloud', cloudProvider: 'custom', apiKey: dedicatedKey, apiBaseUrl: base },
      dedicated: true,
      issue: null,
    };
  }

  // 'inherit' → Jarvis LLM bağlantısı, olmazsa ana bağlantı
  const jarvisSettings = jarvisEffectiveSettings(settings);
  if (SPEECH_CAPABLE(jarvisSettings)) {
    return { settings: jarvisSettings, dedicated: false, issue: null };
  }
  if (SPEECH_CAPABLE(settings)) {
    return { settings, dedicated: false, issue: null };
  }
  return {
    settings,
    dedicated: false,
    issue: 'Seçili bağlantı ses üretemiyor. Jarvis konsolundan ses için ayrı bir API (Gemini veya OpenAI uyumlu) bağla ya da cihaz sesini seç.',
  };
}
