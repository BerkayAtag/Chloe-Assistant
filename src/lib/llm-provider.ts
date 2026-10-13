import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';
import { activeCustomProvider, type Settings } from './settings';

/**
 * Ayarlardan uygun dil modelini üretir.
 * - provider === 'local' → Local LLM: Ollama (OpenAI uyumlu uç nokta)
 * - provider === 'cloud' → yerleşik API veya OpenAI-uyumlu herhangi bir uç nokta
 *
 * Eksik API anahtarı gibi yapılandırma hatalarında anlaşılır bir
 * Türkçe hata fırlatır.
 */
export function getProvider(settings: Settings): LanguageModel {
  if (settings.provider === 'local') {
    const url = settings.ollamaUrl || 'http://127.0.0.1:11434/v1';
    const ollama = createOpenAI({
      baseURL: url,
      apiKey: 'ollama',
    });
    return ollama.chat(settings.ollamaModel || 'llama3.1');
  }

  // ── Cloud (API Key) ─────────────────────────────
  const apiKey = settings.apiKey?.trim();

  switch (settings.cloudProvider) {
    case 'custom': {
      const saved = activeCustomProvider(settings);
      const customApiKey = saved?.apiKey.trim() || apiKey;
      const customModel = saved?.model.trim() || settings.customModel.trim();
      const baseURL = saved?.baseUrl.trim() || settings.apiBaseUrl.trim();
      if (!customApiKey) {
        throw new Error('Özel sağlayıcı için API anahtarı gerekli.');
      }
      if (!customModel) {
        throw new Error('Özel sağlayıcı için model kimliğini gir.');
      }
      let endpoint: URL;
      try {
        endpoint = new URL(baseURL);
      } catch {
        throw new Error('Geçerli bir API adresi gir. Örnek: https://openrouter.ai/api/v1');
      }
      if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
        throw new Error('API adresi HTTP veya HTTPS olmalı ve kullanıcı bilgisi içermemeli.');
      }
      return createOpenAI({ apiKey: customApiKey, baseURL: endpoint.toString().replace(/\/+$/u, '') })
        .chat(customModel);
    }
    case 'openai': {
      const key = apiKey || process.env.OPENAI_API_KEY || '';
      if (!key) {
        throw new Error(
          'OpenAI API anahtarı yok. Ayarlar → API Key alanına OpenAI anahtarını yaz veya OPENAI_API_KEY ortam değişkenini tanımla.'
        );
      }
      return createOpenAI({ apiKey: key })(settings.cloudModel || 'gpt-4o-mini');
    }
    case 'anthropic': {
      const key = apiKey || process.env.ANTHROPIC_API_KEY || '';
      if (!key) {
        throw new Error(
          'Anthropic API anahtarı yok. Ayarlar → API Key alanına Anthropic anahtarını yaz veya ANTHROPIC_API_KEY ortam değişkenini tanımla.'
        );
      }
      return createAnthropic({ apiKey: key })(
        settings.cloudModel || 'claude-sonnet-4-20250514'
      );
    }
    case 'gemini': {
      const key = apiKey || process.env.GEMINI_API_KEY || '';
      if (!key) {
        throw new Error(
          'Gemini API anahtarı yok. Ayarlar → API Key alanına Google Gemini anahtarını yaz veya GEMINI_API_KEY ortam değişkenini tanımla.'
        );
      }
      return createGoogleGenerativeAI({ apiKey: key }).interactions(
        settings.cloudModel || 'gemini-3.8-flash'
      );
    }
    default: throw new Error('Geçersiz AI sağlayıcısı. Ayarlardan bir sağlayıcı seç. Başka servise otomatik geçilmedi.');
  }
}
