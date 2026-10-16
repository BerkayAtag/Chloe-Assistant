import type { Settings } from './settings';

/** FreeLLMAPI's documented fast router, for voice turns only. Never change keys,
 * endpoints, explicit model choices, team settings, or unsupported providers. */
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
