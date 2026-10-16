export type Theme = 'dark' | 'black' | 'light';
/**
 * Model kaynağı:
 * - 'cloud' → API Key ile bulut modeli (yerleşik veya OpenAI uyumlu API)
 * - 'local' → Local LLM (Ollama, OpenAI uyumlu uç nokta)
 */
export type Provider = 'cloud' | 'local';
export type CloudProvider = 'openai' | 'gemini' | 'anthropic' | 'custom';
export type JarvisVoiceTone = 'natural' | 'warm' | 'calm';
export type ThinkingMode = 'fast' | 'medium' | 'high';

export interface SavedApiKey {
  id: string;
  name: string;
  provider: CloudProvider;
  baseUrl: string;
  apiKey: string;
  isDefault: boolean;
}

/** Connection data is shared by web and native clients through the local vault. */
export const CONNECTION_FIELDS = ['provider', 'cloudProvider', 'cloudModel', 'apiKey',
  'builtinConnections', 'apiBaseUrl', 'customProviderName', 'customModel', 'customSupportsTools',
  'customImageModel', 'customVideoModel', 'customSpeechModel', 'customSpeechVoice',
  'savedCustomProviders', 'selectedCustomProviderId', 'savedApiKeys', 'ollamaUrl', 'ollamaModel'] as const;
export type ConnectionSettings = Pick<Settings, typeof CONNECTION_FIELDS[number]>;

export interface SavedCustomProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  supportsTools: boolean;
  imageModel?: string;
  videoModel?: string;
  speechModel?: string;
  speechVoice?: string;
}

export interface Settings {
  /** Model kaynağı: 'cloud' = API Key, 'local' = Local LLM (Ollama) */
  provider: Provider;

  // ── API Key (Bulut) ─────────────────────────────
  cloudProvider: CloudProvider;
  cloudModel: string;
  apiKey: string;
  savedApiKeys: SavedApiKey[];
  builtinConnections: Partial<Record<Exclude<CloudProvider, 'custom'>, { apiKey: string; model: string }>>;
  apiBaseUrl: string;
  customProviderName: string;
  customModel: string;
  customSupportsTools: boolean;
  customImageModel: string;
  customVideoModel: string;
  customSpeechModel: string;
  customSpeechVoice: string;
  savedCustomProviders: SavedCustomProvider[];
  selectedCustomProviderId: string;
  jarvisMode: boolean;
  jarvisFastMode: boolean;
  jarvisVoiceURI: string;
  jarvisVoiceTone: JarvisVoiceTone;
  jarvisSpeechEngine: 'main' | 'device';
  jarvisCloudVoice: string;
  jarvisSpeechApiKey: string;
  jarvisInstructions: string;
  thinkingMode: ThinkingMode;

  // ── Local LLM (Ollama) ──────────────────────────
  ollamaUrl: string;
  ollamaModel: string;

  // ── Özellikler ──────────────────────────────────
  /** Web araması (default: AÇIK) */
  webSearch: boolean;

  // ── Kimlik ──────────────────────────────────────
  assistantName: string;
  userName: string;
  theme: Theme;
}

const STORAGE_KEY = 'kisisel-ai-asistan:settings';

export const DEFAULT_SETTINGS: Settings = {
  provider: 'cloud',
  ollamaUrl: 'http://127.0.0.1:11434/v1',
  ollamaModel: 'llama3.2:1b',
  cloudProvider: 'gemini',
  cloudModel: 'gemini-3.8-flash',
  apiKey: '',
  savedApiKeys: [],
  builtinConnections: {},
  apiBaseUrl: '',
  customProviderName: '',
  customModel: '',
  customSupportsTools: false,
  customImageModel: 'auto',
  customVideoModel: 'auto',
  customSpeechModel: 'auto',
  customSpeechVoice: 'nova',
  savedCustomProviders: [],
  selectedCustomProviderId: '',
  jarvisMode: false,
  jarvisFastMode: true,
  jarvisVoiceURI: '',
  jarvisVoiceTone: 'natural',
  jarvisSpeechEngine: 'main',
  jarvisCloudVoice: 'Kore',
  jarvisSpeechApiKey: '',
  jarvisInstructions: '',
  thinkingMode: 'medium',
  webSearch: true,
  assistantName: 'Chloe',
  userName: '',
  theme: 'dark',
};

/** Bulut sağlayıcıları için sık kullanılan model önerileri. */
export const CLOUD_MODEL_SUGGESTIONS: Record<CloudProvider, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1', 'o4-mini'],
  gemini: ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash'],
  anthropic: [
    'claude-sonnet-4-20250514',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
  ],
  custom: [],
};

export const LOCAL_MODEL_SUGGESTIONS = [
  'deepseek-r1:8b',
  'llama3.2:1b',
  'llama3:latest',
  'dolphin3:latest',
  'codellama:7b',
  'llama3.1',
  'qwen2.5',
  'qwen3',
  'gemma2',
  'mistral',
];

export function activeCustomProvider(settings: Settings): SavedCustomProvider | null {
  const providers = Array.isArray(settings.savedCustomProviders) ? settings.savedCustomProviders : [];
  const profile = providers.find(
    (provider) => provider.id === settings.selectedCustomProviderId
  ) || null;
  // The visible fields are authoritative. A saved profile must never override
  // an edited (or deliberately cleared) key, endpoint, model or capability.
  return profile ? { ...profile, name: settings.customProviderName, baseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey, model: settings.customModel, supportsTools: settings.customSupportsTools,
    imageModel: settings.customImageModel, videoModel: settings.customVideoModel,
    speechModel: settings.customSpeechModel, speechVoice: settings.customSpeechVoice } : null;
}

/** Provider switches are atomic: never send another provider's key/model. */
export function updateProviderSettings(settings: Settings, patch: Partial<Settings>): Settings {
  let next = { ...settings, ...patch };
  if (settings.cloudProvider === 'custom' && patch.apiBaseUrl !== undefined && patch.apiBaseUrl !== settings.apiBaseUrl && patch.apiKey === undefined) next.apiKey = '';
  if (patch.cloudProvider && patch.cloudProvider !== settings.cloudProvider) {
    const connections = { ...settings.builtinConnections };
    if (settings.cloudProvider !== 'custom') connections[settings.cloudProvider] = { apiKey: settings.apiKey, model: settings.cloudModel };
    if (patch.cloudProvider === 'custom') {
      const saved = settings.savedCustomProviders.find((p) => p.id === settings.selectedCustomProviderId);
      next = { ...next, apiKey: saved?.apiKey || '', customModel: saved?.model || '',
        apiBaseUrl: saved?.baseUrl || '', customProviderName: saved?.name || '', customSupportsTools: saved?.supportsTools ?? false,
        customImageModel: saved?.imageModel || 'auto', customVideoModel: saved?.videoModel || 'auto',
        customSpeechModel: saved?.speechModel || 'auto', customSpeechVoice: saved?.speechVoice || 'nova' };
    } else {
      const saved = connections[patch.cloudProvider];
      next = { ...next, apiKey: saved?.apiKey || '', cloudModel: saved?.model || CLOUD_MODEL_SUGGESTIONS[patch.cloudProvider][0] };
    }
    next.builtinConnections = connections;
    const preferred = next.savedApiKeys?.find((key) => key.isDefault && key.provider === next.cloudProvider &&
      (key.provider !== 'custom' || key.baseUrl.replace(/\/+$/, '') === next.apiBaseUrl.replace(/\/+$/, '')));
    if (preferred) next.apiKey = preferred.apiKey;
  }
  if (next.cloudProvider === 'custom' && next.selectedCustomProviderId) {
    const active = activeCustomProvider(next);
    if (active) next.savedCustomProviders = next.savedCustomProviders.map((p) => p.id === active.id ? active : p);
  }
  return next;
}

export function providerName(settings: Settings): string {
  if (settings.provider === 'local') return 'Yerel LLM';
  return { openai: 'OpenAI', gemini: 'Gemini', anthropic: 'Claude', custom: settings.customProviderName.trim() || 'Özel API' }[settings.cloudProvider] || 'Bilinmeyen sağlayıcı';
}

/** Missing client state must not silently activate the default cloud provider. */
export function hasExplicitConnection(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<Settings>;
  return candidate.provider === 'local' || (candidate.provider === 'cloud' &&
    ['gemini', 'openai', 'anthropic', 'custom'].includes(candidate.cloudProvider || ''));
}

export function modalityStatus(settings: Settings, type: 'speech' | 'image' | 'video'): { supported: boolean; label: string; detail: string } {
  const name = providerName(settings);
  const supported = settings.provider === 'cloud' && ['gemini', 'custom'].includes(settings.cloudProvider);
  const feature = { speech: 'Doğal ses', image: 'Görsel üretimi', video: 'Video üretimi' }[type];
  return { supported, label: name, detail: supported
    ? `${feature}: ${name} bağlantısı ve güncel API anahtarı kullanılır. Sağlayıcı/model desteği gerekir; başka servise geçilmez.`
    : `${name} için ${feature.toLocaleLowerCase('tr-TR')} bağlantısı bu sürümde yok. Gemini'ye otomatik geçilmedi.${type === 'speech' ? ' İstersen cihaz sesini seçebilirsin.' : ''}` };
}

export function settingsForRequest(
  settings: Settings,
  overrides: Partial<Settings> = {}
): Settings {
  const requestSettings = { ...settings, ...overrides };
  return {
    ...requestSettings,
    apiKey: requestSettings.provider === 'local' ? '' : requestSettings.apiKey,
    builtinConnections: {},
    savedApiKeys: [],
    jarvisSpeechApiKey: '',
    savedCustomProviders: [],
    selectedCustomProviderId: '',
  };
}

/** Ayarlara göre etkin modelin kısa özeti (arayüzde göstermek için). */
export function modelLabel(settings: Settings): string {
  if (settings.provider === 'local') {
    return `Local · ${settings.ollamaModel || 'llama3.1'}`;
  }
  const saved = settings.cloudProvider === 'custom' ? activeCustomProvider(settings) : null;
  const providerName =
    settings.cloudProvider === 'openai'
      ? 'OpenAI'
      : settings.cloudProvider === 'gemini'
        ? 'Gemini'
        : settings.cloudProvider === 'anthropic'
          ? 'Claude'
          : saved?.name || settings.customProviderName.trim() || 'Diğer API';
  const model = settings.cloudProvider === 'custom'
    ? saved?.model || settings.customModel
    : settings.cloudModel;
  return model ? `${providerName} · ${model}` : providerName;
}

export function loadSettings(): Settings {
  if (typeof window === 'undefined') return { ...DEFAULT_SETTINGS };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULT_SETTINGS, ...parsed };
    merged.savedCustomProviders = Array.isArray(parsed.savedCustomProviders)
      ? parsed.savedCustomProviders.filter((item: unknown): item is SavedCustomProvider => {
          if (!item || typeof item !== 'object') return false;
          const provider = item as Record<string, unknown>;
          return (
            typeof provider.id === 'string' &&
            typeof provider.name === 'string' &&
            typeof provider.baseUrl === 'string' &&
            typeof provider.apiKey === 'string' &&
            typeof provider.model === 'string' &&
            typeof provider.supportsTools === 'boolean'
          );
        })
      : [];
    merged.selectedCustomProviderId =
      typeof parsed.selectedCustomProviderId === 'string' ? parsed.selectedCustomProviderId : '';
    merged.jarvisMode = parsed.jarvisMode === true;
    merged.jarvisVoiceURI =
      typeof parsed.jarvisVoiceURI === 'string' ? parsed.jarvisVoiceURI : '';
    // Old Gemini-only speech now inherits the explicitly selected main API.
    merged.jarvisSpeechEngine = parsed.jarvisSpeechEngine === 'device' ? 'device' : 'main';
    merged.builtinConnections = {};
    merged.savedApiKeys = Array.isArray(parsed.savedApiKeys) ? parsed.savedApiKeys.filter((key: SavedApiKey) =>
      key && typeof key.id === 'string' && typeof key.name === 'string' && typeof key.apiKey === 'string' &&
      ['gemini', 'openai', 'anthropic', 'custom'].includes(key.provider) && typeof key.baseUrl === 'string') : [];
    for (const name of ['gemini', 'openai', 'anthropic'] as const) {
      const connection = parsed.builtinConnections?.[name];
      if (connection && typeof connection.apiKey === 'string' && typeof connection.model === 'string') merged.builtinConnections[name] = connection;
    }
    const active = merged.savedCustomProviders.find((p: SavedCustomProvider) => p.id === merged.selectedCustomProviderId);
    for (const [field, savedField] of [['customImageModel', 'imageModel'], ['customVideoModel', 'videoModel'], ['customSpeechModel', 'speechModel'], ['customSpeechVoice', 'speechVoice']] as const) {
      merged[field] = typeof parsed[field] === 'string' ? parsed[field] : active?.[savedField] || DEFAULT_SETTINGS[field];
    }
    merged.jarvisCloudVoice = typeof parsed.jarvisCloudVoice === 'string' ? parsed.jarvisCloudVoice : 'Kore';
    merged.jarvisSpeechApiKey = typeof parsed.jarvisSpeechApiKey === 'string' ? parsed.jarvisSpeechApiKey : '';
    merged.jarvisInstructions = typeof parsed.jarvisInstructions === 'string' ? parsed.jarvisInstructions.slice(0, 4000) : '';
    merged.thinkingMode = ['fast', 'medium', 'high'].includes(parsed.thinkingMode) ? parsed.thinkingMode : DEFAULT_SETTINGS.thinkingMode;
    if (!['natural', 'warm', 'calm'].includes(merged.jarvisVoiceTone)) {
      merged.jarvisVoiceTone = DEFAULT_SETTINGS.jarvisVoiceTone;
    }
    if (!['openai', 'gemini', 'anthropic', 'custom'].includes(merged.cloudProvider)) {
      merged.cloudProvider = DEFAULT_SETTINGS.cloudProvider;
    }
    // Google'ın kapattığı Gemini 2.0 varsayılanını daha önce kaydedilmiş
    // tarayıcı ayarlarında da otomatik olarak güncelle; kullanıcının API
    // anahtarını ve diğer kişisel tercihlerini koru.
    if (merged.cloudProvider === 'gemini' && merged.cloudModel === 'gemini-2.0-flash') {
      merged.cloudModel = DEFAULT_SETTINGS.cloudModel;
    }
    return merged;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, vaultSaved = false): void {
  if (typeof window === 'undefined') return;
  try {
    // Once migration is acknowledged, browser storage contains preferences only.
    const stored = vaultSaved ? { ...settings, apiKey: '', jarvisSpeechApiKey: '', savedApiKeys: [],
      builtinConnections: {}, savedCustomProviders: settings.savedCustomProviders.map((p) => ({ ...p, apiKey: '' })) } : settings;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* storage dolu/engelli → yut */
  }
}
