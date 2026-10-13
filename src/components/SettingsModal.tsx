'use client';
import { useState, useRef, useEffect } from 'react';
import { X, Eye, EyeOff, RefreshCw, Server, KeyRound, Globe, PlugZap } from 'lucide-react';
import { flushSettings, retrySettings, type ConnectionStorageStatus } from '@/hooks/useSettings';
import {
  type Settings,
  type Theme,
  CLOUD_MODEL_SUGGESTIONS,
  LOCAL_MODEL_SUGGESTIONS,
  settingsForRequest,
  updateProviderSettings,
  modelLabel,
  modalityStatus,
} from '@/lib/settings';

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  onChange,
  storage,
}: {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onChange: (s: Settings) => void;
  storage: ConnectionStorageStatus;
}) {
  const [showKey, setShowKey] = useState(false);
  const [localModels, setLocalModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelListError, setModelListError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [cloudModels, setCloudModels] = useState<string[]>([]);
  const testController = useRef<AbortController | null>(null);
  useEffect(() => () => testController.current?.abort(), []);

  if (!isOpen) return null;

  const set = (patch: Partial<Settings>) => {
    testController.current?.abort();
    setTestingConnection(false);
    setLoadingModels(false);
    setModelListError(null);
    setConnectionStatus(null);
    setCloudModels([]);
    onChange(updateProviderSettings(settings, patch));
  };

  const field =
    'w-full p-3 bg-white dark:bg-night-800 border border-gray-300 dark:border-night-700 rounded-lg text-gray-900 dark:text-white focus:ring-2 focus:ring-app-accent focus:border-app-accent outline-none transition-all placeholder-gray-400 dark:placeholder-gray-500';
  const label = 'block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1';

  const cloudSuggestions = settings.cloudProvider === 'custom'
    ? cloudModels
    : CLOUD_MODEL_SUGGESTIONS[settings.cloudProvider] || [];
  const providerOptions = [
    { value: 'openai', name: 'OpenAI', description: 'OpenAI API', icon: 'O' },
    { value: 'gemini', name: 'Gemini', description: 'Google AI Studio', icon: 'G' },
    { value: 'anthropic', name: 'Claude', description: 'Anthropic API', icon: 'C' },
    { value: 'custom', name: 'Diğer API', description: 'OpenAI uyumlu servis', icon: '↗' },
  ] as const;
  const scopedKeys = settings.savedApiKeys.filter((key) => key.provider === settings.cloudProvider &&
    (key.provider !== 'custom' || key.baseUrl.replace(/\/+$/, '') === settings.apiBaseUrl.replace(/\/+$/, '')));
  const currentKey = scopedKeys.find((key) => key.apiKey === settings.apiKey);
  const isFreeLLM = settings.cloudProvider === 'custom' && /freellm/i.test(settings.customProviderName);
  const saveNamedKey = async () => {
    if (!settings.apiKey.trim()) { setConnectionStatus({ kind: 'error', message: 'Önce API anahtarını gir.' }); return; }
    if (settings.cloudProvider === 'custom') {
      try { const u = new URL(settings.apiBaseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw new Error(); }
      catch { setConnectionStatus({ kind: 'error', message: 'Önce geçerli API adresini gir.' }); return; }
    }
    const key = { id: currentKey?.id || crypto.randomUUID(), provider: settings.cloudProvider,
      name: keyName.trim() || currentKey?.name || `${settings.cloudProvider === 'gemini' ? 'Google' : settings.customProviderName || settings.cloudProvider} · ${scopedKeys.length + 1}. anahtar`,
      baseUrl: settings.cloudProvider === 'custom' ? settings.apiBaseUrl : '', apiKey: settings.apiKey.trim(), isDefault: currentKey?.isDefault ?? !scopedKeys.length };
    set({ savedApiKeys: [...settings.savedApiKeys.filter((k) => k.id !== key.id), key] });
    if (await flushSettings()) { setKeyName(''); setConnectionStatus({ kind: 'success', message: 'Anahtar şifreli kasaya kaydedildi.' }); }
  };
  const listCloudModels = async () => {
    testController.current?.abort(); const controller = new AbortController(); testController.current = controller;
    setLoadingModels(true); setModelListError(null);
    try {
      const response = await fetch('/api/providers/models', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: settingsForRequest(settings) }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const data = await response.json(); if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || 'Model listesi alınamadı.');
      setCloudModels(data.models); setConnectionStatus({ kind: 'success', message: `${data.models.length} model bulundu. Model alanından seçebilirsin.` });
    } catch (error) { if (!controller.signal.aborted) setModelListError(error instanceof Error ? error.message : 'Model listesi alınamadı.'); }
    finally { if (testController.current === controller) setLoadingModels(false); }
  };

  const fetchLocalModels = async () => {
    setLoadingModels(true);
    setModelListError(null);
    try {
      const res = await fetch(
        `/api/local/models?url=${encodeURIComponent(settings.ollamaUrl || 'http://127.0.0.1:11434')}`
      );
      const data = await res.json();
      if (data.success) {
        setLocalModels(data.models || []);
      } else {
        setModelListError(data.error || 'Model listesi alınamadı.');
        setLocalModels([]);
      }
    } catch (e: unknown) {
      setModelListError(
        e instanceof Error ? e.message : 'Model listesi alınamadı.'
      );
      setLocalModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const selectCustomProvider = (id: string) => {
    setCloudModels([]); setModelListError(null); setLoadingModels(false);
    const selected = settings.savedCustomProviders.find((provider) => provider.id === id);
    if (!selected) return;
    onChange({
      ...updateProviderSettings(settings, { cloudProvider: 'custom' }),
      provider: 'cloud',
      cloudProvider: 'custom',
      selectedCustomProviderId: selected.id,
      customProviderName: selected.name,
      apiBaseUrl: selected.baseUrl,
      apiKey: selected.apiKey,
      customModel: selected.model,
      customSupportsTools: selected.supportsTools,
      customImageModel: selected.imageModel || 'auto',
      customVideoModel: selected.videoModel || 'auto',
      customSpeechModel: selected.speechModel || 'auto',
      customSpeechVoice: selected.speechVoice || 'nova',
    });
    testController.current?.abort(); setTestingConnection(false);
    setConnectionStatus(null);
  };

  const startNewCustomProvider = () => {
    setCloudModels([]); setModelListError(null); setLoadingModels(false);
    onChange({
      ...updateProviderSettings(settings, { cloudProvider: 'custom' }),
      provider: 'cloud',
      cloudProvider: 'custom',
      selectedCustomProviderId: '',
      customProviderName: '',
      apiBaseUrl: '',
      apiKey: '',
      customModel: '',
      customSupportsTools: false,
      customImageModel: 'auto', customVideoModel: 'auto', customSpeechModel: 'auto', customSpeechVoice: 'nova',
    });
    testController.current?.abort(); setTestingConnection(false);
    setConnectionStatus(null);
  };

  const saveCustomProvider = () => {
    const name = settings.customProviderName.trim();
    const baseUrl = settings.apiBaseUrl.trim();
    const apiKey = settings.apiKey.trim();
    const model = settings.customModel.trim();
    if (!baseUrl || !apiKey || !model) {
      setConnectionStatus({
        kind: 'error',
        message: 'Kaydetmeden önce API adresi, API anahtarı ve model kimliğini doldur.',
      });
      return;
    }
    let endpoint: URL;
    try {
      endpoint = new URL(baseUrl);
    } catch {
      setConnectionStatus({ kind: 'error', message: 'Geçerli bir HTTP veya HTTPS API adresi gir.' });
      return;
    }
    if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      setConnectionStatus({ kind: 'error', message: 'API adresi HTTP/HTTPS olmalı ve kullanıcı bilgisi içermemeli.' });
      return;
    }
    const id = settings.selectedCustomProviderId || crypto.randomUUID();
    const config = {
      id,
      name: name || 'Özel API',
      baseUrl,
      apiKey,
      model,
      supportsTools: settings.customSupportsTools,
      imageModel: settings.customImageModel, videoModel: settings.customVideoModel,
      speechModel: settings.customSpeechModel, speechVoice: settings.customSpeechVoice,
    };
    const exists = settings.savedCustomProviders.some((item) => item.id === id);
    set({
      provider: 'cloud',
      cloudProvider: 'custom',
      selectedCustomProviderId: id,
      savedCustomProviders: exists
        ? settings.savedCustomProviders.map((item) => item.id === id ? config : item)
        : [...settings.savedCustomProviders, config],
      customProviderName: config.name,
      apiBaseUrl: baseUrl,
      apiKey,
      customModel: model,
    });
    setConnectionStatus({ kind: 'success', message: `“${config.name}” bağlantı profiline kaydedildi.` });
  };

  const deleteCustomProvider = () => {
    const id = settings.selectedCustomProviderId;
    if (!id) return;
    set({
      savedCustomProviders: settings.savedCustomProviders.filter((item) => item.id !== id),
      selectedCustomProviderId: '',
      customProviderName: '',
      apiBaseUrl: '',
      apiKey: '',
      customModel: '',
      customSupportsTools: false,
    });
    setConnectionStatus({ kind: 'success', message: 'API profili kaldırıldı. Anahtarın kalıcı kasada korunuyor.' });
  };

  const testConnection = async () => {
    testController.current?.abort();
    const controller = new AbortController(); testController.current = controller;
    setTestingConnection(true);
    setConnectionStatus(null);
    try {
      const response = await fetch('/api/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
        body: JSON.stringify({
          settings: settingsForRequest(settings),
        }),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(data.error || 'Model bağlantısı kurulamadı.');
      setConnectionStatus({
        kind: 'success',
        message: `Bağlandı: ${data.provider} · ${data.model} (${data.response})`,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setConnectionStatus({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Model bağlantısı kurulamadı.',
      });
    } finally {
      if (testController.current === controller) setTestingConnection(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div role="dialog" aria-modal="true" aria-label="Ayarlar" className="bg-white dark:bg-night-900 border border-gray-300 dark:border-night-750 w-full max-w-lg rounded-2xl shadow-2xl p-6 relative max-h-[90vh] overflow-y-auto custom-scrollbar">
        <button
          onClick={async () => { if (await flushSettings()) onClose(); }}
          className="absolute top-4 right-4 text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition-colors"
          aria-label="Kapat"
        >
          <X size={24} />
        </button>

        <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Ayarlar</h2>

        <div className="space-y-6">
          <section aria-label="Kalıcı bağlantı kasası" className="rounded-xl border border-app-border bg-app-surface p-4 text-sm">
            <h3 className="font-semibold">Kalıcı bağlantı kasası</h3>
            <p role="status" className={`mt-1 text-xs ${storage.state === 'error' ? 'text-app-danger' : 'text-app-muted'}`}>{storage.message}</p>
            <p className="mt-2 text-xs text-app-muted">Anahtarlar bu bilgisayarda şifreli saklanır. Uygulama güncellemesi veya tarayıcı verilerini temizlemek kasayı silmez. Google ve FreeLLMAPI ayrı kayıtlarını korur.</p>
            {storage.state === 'error' && <button onClick={() => void retrySettings()} className="mt-2 underline">Kaydı yeniden dene</button>}
          </section>
          {/* ── Model Seçimi ─────────────────────────────── */}
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-2">
              Model Kaynağı
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => set({ provider: 'local' })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  settings.provider === 'local'
                    ? 'border-app-accent bg-app-accent/10 ring-1 ring-app-accent'
                    : 'border-gray-300 dark:border-night-700 hover:border-app-accent/60'
                }`}
              >
                <Server size={18} className={settings.provider === 'local' ? 'text-app-accent' : 'text-gray-400'} />
                <div className="mt-1.5 text-sm font-medium text-gray-900 dark:text-white">Local LLM</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  Ollama / kendi makinan
                </div>
              </button>
              <button
                onClick={() => set({ provider: 'cloud' })}
                className={`p-3 rounded-xl border text-left transition-all ${
                  settings.provider === 'cloud'
                    ? 'border-app-accent bg-app-accent/10 ring-1 ring-app-accent'
                    : 'border-gray-300 dark:border-night-700 hover:border-app-accent/60'
                }`}
              >
                <KeyRound size={18} className={settings.provider === 'cloud' ? 'text-app-accent' : 'text-gray-400'} />
                <div className="mt-1.5 text-sm font-medium text-gray-900 dark:text-white">API Key</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    OpenAI / Gemini / Claude / diğerleri
                </div>
              </button>
            </div>
          </div>

          {/* ── Local LLM ayarları ──────────────────────── */}
          {settings.provider === 'local' ? (
            <div className="space-y-4">
              <div>
                <label className={label}>Ollama Endpoint</label>
                <input
                  type="text"
                  value={settings.ollamaUrl}
                  onChange={(e) => set({ ollamaUrl: e.target.value })}
                  className={field}
                  placeholder="http://127.0.0.1:11434/v1"
                />
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Yerel: http://127.0.0.1:11434/v1 · Uzak makine: http://&lt;IP&gt;:11434/v1
                </p>
              </div>
              <div>
                <label className={label}>Model Adı</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    list="local-model-options"
                    value={settings.ollamaModel}
                    onChange={(e) => set({ ollamaModel: e.target.value })}
                    className={field}
                    placeholder="llama3.1"
                  />
                  <button
                    type="button"
                    onClick={fetchLocalModels}
                    disabled={loadingModels}
                    className="shrink-0 px-3 rounded-lg border border-gray-300 dark:border-night-700 text-gray-500 dark:text-gray-400 hover:border-app-accent hover:text-app-accent transition-colors disabled:opacity-50"
                    title="Endpoint'teki modelleri listele"
                  >
                    <RefreshCw size={18} className={loadingModels ? 'animate-spin' : ''} />
                  </button>
                </div>
                <datalist id="local-model-options">
                  {[...new Set([...localModels, ...LOCAL_MODEL_SUGGESTIONS])].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {modelListError && (
                  <p className="mt-1 text-xs text-red-400">{modelListError}</p>
                )}
                {localModels.length > 0 && (
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {"Endpoint'teki modeller: "}
                    {localModels.join(', ')}
                  </p>
                )}
              </div>
            </div>
          ) : (
            /* ── Cloud (API Key) ayarları ──────────────── */
            <div className="space-y-4">
              <div>
                <label className={label}>Sağlayıcı</label>
                <div className="grid grid-cols-2 gap-2">
                  {providerOptions.map(({ value, name, description, icon }) => (
                    <button
                      key={value}
                      onClick={() => set({ cloudProvider: value })}
                      aria-pressed={settings.cloudProvider === value}
                      className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                        settings.cloudProvider === value
                          ? 'border-app-accent bg-app-accent/10 ring-1 ring-app-accent'
                          : 'border-gray-300 dark:border-night-700 hover:border-app-accent/60'
                      }`}
                    >
                      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        settings.cloudProvider === value
                          ? 'bg-app-accent/15 text-app-accent'
                          : 'bg-gray-100 text-gray-500 dark:bg-night-800 dark:text-gray-400'
                      }`}>
                        {value === 'custom' ? <PlugZap size={17} /> : <span className="font-semibold">{icon}</span>}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-gray-900 dark:text-white">{name}</span>
                        <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">{description}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              {settings.cloudProvider === 'custom' && (
                <div className="space-y-4 rounded-xl border border-app-accent/20 bg-app-accent/5 p-4">
                  <div className="flex items-center gap-2">
                    <select
                      aria-label="Kaydedilmiş API bağlantısı"
                      value={settings.selectedCustomProviderId}
                      onChange={(event) => {
                        if (event.target.value) selectCustomProvider(event.target.value);
                        else startNewCustomProvider();
                      }}
                      className={`${field} min-w-0 flex-1`}
                    >
                      <option value="">Yeni API bağlantısı</option>
                      {settings.savedCustomProviders.map((provider) => (
                        <option key={provider.id} value={provider.id}>
                          {provider.name} · {provider.model}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={startNewCustomProvider}
                      className="shrink-0 rounded-lg border border-app-accent px-3 py-3 text-sm font-medium text-app-accent hover:bg-app-accent/10 dark:text-app-accent"
                    >
                      + Ekle
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    İstediğin kadar API profili kaydet; listeden seçerek aralarında geçiş yap.
                  </p>
                  <div>
                    <label htmlFor="custom-provider-name" className={label}>Servis adı <span className="font-normal text-gray-400">(isteğe bağlı)</span></label>
                    <input
                      id="custom-provider-name"
                      type="text"
                      value={settings.customProviderName}
                      onChange={(e) => set({ customProviderName: e.target.value })}
                      className={field}
                      placeholder="Örn: OpenRouter, Groq, DeepSeek"
                      maxLength={80}
                    />
                  </div>
                  <div>
                    <label htmlFor="custom-provider-url" className={label}>API adresi (Base URL)</label>
                    <input
                      id="custom-provider-url"
                      type="url"
                      value={settings.apiBaseUrl}
                      onChange={(e) => set({ apiBaseUrl: e.target.value })}
                      className={field}
                      placeholder="https://openrouter.ai/api/v1"
                      autoComplete="url"
                      maxLength={500}
                    />
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      OpenAI uyumlu Chat Completions API adresini gir. Adres değişirse eski anahtar temizlenir; yeni servisin anahtarını gir.
                    </p>
                  </div>
                </div>
              )}
              <div>
                <label htmlFor="provider-api-key" className={label}>API Key</label>
                {scopedKeys.length > 0 && <div className="mb-3 flex flex-wrap gap-2">
                  <select aria-label="Kayıtlı anahtar" className={`${field} flex-1 min-w-0`} value={currentKey?.id || ''}
                    onChange={(event) => { const key = scopedKeys.find((k) => k.id === event.target.value); if (key) set({ apiKey: key.apiKey }); }}>
                    <option value="">Yeni / düzenlenen anahtar</option>
                    {scopedKeys.map((key) => <option key={key.id} value={key.id}>{key.name}{key.isDefault ? ' · Varsayılan' : ''} · ••••{key.apiKey.slice(-4)}</option>)}
                  </select>
                  <button className="rounded-lg border border-app-border px-3 text-xs disabled:opacity-50" disabled={!currentKey || currentKey.isDefault}
                    onClick={() => set({ savedApiKeys: settings.savedApiKeys.map((k) => scopedKeys.some((s) => s.id === k.id) ? { ...k, isDefault: k.id === currentKey?.id } : k) })}>Varsayılan yap</button>
                </div>}
                <div className="relative">
                  <input
                    key={`${settings.cloudProvider}:${settings.apiBaseUrl}:${settings.apiKey}`}
                    id="provider-api-key"
                    type={showKey ? 'text' : 'password'}
                    defaultValue={settings.apiKey}
                    onBlur={(e) => { if (e.target.value !== settings.apiKey) set({ apiKey: e.target.value.trim() }); }}
                    autoComplete="off"
                    className={field + ' pr-11'}
                    placeholder={
                      settings.cloudProvider === 'openai'
                        ? 'sk-...'
                        : settings.cloudProvider === 'gemini'
                          ? 'AIza...'
                          : settings.cloudProvider === 'anthropic'
                            ? 'sk-ant-...'
                            : 'Servis sağlayıcının API anahtarı'
                    }
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                    aria-label="Anahtarı göster/gizle"
                  >
                    {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  Anahtarı değiştirmek veya alanı temizlemek kasadaki eski anahtarı silmez. Sağlayıcıya geçtiğinde varsayılan anahtar seçilir.
                </p>
                <div className="mt-2 flex gap-2"><input aria-label="Anahtar adı" className={`${field} min-w-0`} placeholder="Anahtar adı (isteğe bağlı)" value={keyName} maxLength={80} onChange={(e) => setKeyName(e.target.value)}/>
                  <button className="shrink-0 rounded-lg border border-app-border px-3 text-xs" onClick={() => void saveNamedKey()}>Kasaya ekle</button></div>
              </div>
              <div>
                <label htmlFor="provider-model" className={label}>Model</label>
                <input
                  id="provider-model"
                  type="text"
                  list="cloud-model-options"
                  value={settings.cloudProvider === 'custom' ? settings.customModel : settings.cloudModel}
                  onChange={(e) => set(settings.cloudProvider === 'custom'
                    ? { customModel: e.target.value }
                    : { cloudModel: e.target.value })}
                  className={field}
                  placeholder={settings.cloudProvider === 'custom' ? 'Servisin model kimliği (örn: openai/gpt-4o-mini)' : 'Örn: gpt-4o-mini'}
                  maxLength={200}
                />
                <datalist id="cloud-model-options">
                  {[...new Set([...cloudSuggestions, ...cloudModels])].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {['custom', 'gemini', 'openai'].includes(settings.cloudProvider) && <button type="button" onClick={() => void listCloudModels()} disabled={loadingModels}
                  className="mt-2 rounded-lg border border-app-border px-3 py-2 text-xs disabled:opacity-50">{loadingModels ? 'Modeller alınıyor…' : 'API’den modelleri getir'}</button>}
                {modelListError && <p role="alert" className="mt-2 text-xs text-app-danger">{modelListError}</p>}
                {isFreeLLM && <div className="mt-3"><label htmlFor="free-routing" className={label}>FreeLLMAPI yönlendirmesi</label>
                  <select id="free-routing" className={field} value={['auto','auto:fast','auto:smart','auto:reliable','auto:balanced','fusion'].includes(settings.customModel) ? settings.customModel : ''}
                    onChange={(event) => { if (event.target.value) set({ customModel: event.target.value }); }}>
                    <option value="">Özel model / profil</option><option value="auto">Otomatik · etkin zincir</option><option value="auto:fast">En hızlı</option>
                    <option value="auto:smart">En yetenekli</option><option value="auto:reliable">En güvenilir</option><option value="auto:balanced">Dengeli</option><option value="fusion">Fusion · çoklu model sentezi</option>
                  </select><p className="mt-1 text-xs text-app-muted">Yönlendirmeyi FreeLLMAPI yapar. Kullanılabilir modeller ve kotalar servisteki anahtarlara bağlıdır.</p></div>}
                {settings.cloudProvider === 'custom' && (
                  <>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      Model kimliğini API servisindeki biçimiyle aynen gir. Uç noktanın OpenAI uyumlu Chat Completions isteklerini desteklemesi gerekir.
                    </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      ['FreeLLMAPI', 'http://127.0.0.1:31415/v1'],
                      ['OpenRouter', 'https://openrouter.ai/api/v1'],
                      ['Groq', 'https://api.groq.com/openai/v1'],
                      ['DeepSeek', 'https://api.deepseek.com'],
                      ['Together AI', 'https://api.together.xyz/v1'],
                    ].map(([name, url]) => (
                      <button
                        type="button"
                        key={name}
                        onClick={() => set({ customProviderName: name, apiBaseUrl: url, ...(name === 'FreeLLMAPI' ? { customModel: 'auto', customSupportsTools: true } : {}) })}
                        className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:border-app-accent hover:text-app-accent dark:border-night-700 dark:text-gray-300"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  </>
                )}
              </div>
              {settings.cloudProvider === 'custom' && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 p-3 dark:border-night-750">
                  <input
                    type="checkbox"
                    checked={settings.customSupportsTools}
                    onChange={(e) => set({ customSupportsTools: e.target.checked })}
                    className="mt-0.5 accent-cyan-500"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900 dark:text-white">Model araç çağırmayı destekliyor</span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">
                      Web arama ve asistan araçlarını kullanır. Desteklemiyorsa kapalı bırak.
                    </span>
                  </span>
                </label>
              )}
              {settings.cloudProvider === 'custom' && <details className="rounded-xl border border-gray-300 p-3 dark:border-night-700">
                <summary className="cursor-pointer text-sm font-medium">Ses ve medya modelleri (aynı API)</summary>
                <p className="mt-2 text-xs text-gray-500">FreeLLMAPI için auto kullanılabilir. Diğer servislerde desteklenen model kimliklerini gir. Ana modelin API adresi ve anahtarı kullanılır; başka sağlayıcıya geçilmez.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">{([
                  ['customSpeechModel', 'Ses modeli'], ['customSpeechVoice', 'Ses kimliği'],
                  ['customImageModel', 'Görsel modeli'], ['customVideoModel', 'Video modeli'],
                ] as const).map(([name, title]) => <label key={name} className={label}>{title}<input value={settings[name]} onChange={(e) => set({ [name]: e.target.value })} className={field} maxLength={200}/></label>)}</div>
                <p className="mt-2 text-xs text-gray-500">Ses: /audio/speech · Görsel: /images/generations · Video: /videos/generations. Servisin bu uç noktaları sunması gerekir.</p>
              </details>}
            </div>
          )}

          <section className="rounded-xl border border-app-border bg-app-surface p-4">
            <label htmlFor="thinking-mode" className="text-sm font-semibold text-app-text">Daha çok düşün</label>
            <select id="thinking-mode" value={settings.thinkingMode} onChange={(event) => set({ thinkingMode: event.target.value as Settings['thinkingMode'] })} className={`${field} mt-2`}>
              <option value="fast">Hızlı</option><option value="medium">Orta</option><option value="high">Yüksek</option>
            </select>
            <p className="mt-2 text-xs leading-5 text-app-muted">
              Destekleyen modellerde Gemini 2.5/3, Anthropic Claude 3.7/4 ve OpenAI o-serisi/GPT-5 için sağlayıcıya uygun düşünme ayarı gönderilir. Diğer model, özel OpenAI uyumlu API ve yerel modellerde sağlayıcı bu seçeneği sunmuyorsa istek değiştirilmez.
            </p>
          </section>

          <section aria-label="Etkin AI bağlantısı" className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">Ana model: {modelLabel(settings)}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Sohbet, araştırma, JARVIS yanıtları, Codex ve “Sohbet ayarlarını kullan” seçili ajanlar bu bağlantıyı izler. Ayrı bağlantılı ajanlar ekip ayarlarında açıkça belirtilir.</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{modalityStatus(settings, 'speech').detail}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{modalityStatus(settings, 'image').detail}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{modalityStatus(settings, 'video').detail}</p>
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">Değişiklikler anında kaydedilir. Sağlayıcı değişince anahtar ve model o sağlayıcının profiline göre yenilenir.</p>
          </section>

          {/* ── Özellikler ───────────────────────────────── */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-gray-200 dark:border-night-750 bg-gray-50 dark:bg-night-850">
            <div className="flex items-center gap-2.5">
              <Globe size={18} className="text-app-accent" />
              <div>
                <div className="text-sm font-medium text-gray-900 dark:text-white">Web Araması</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  Güncel bilgi için internete danışır (varsayılan: açık)
                </div>
              </div>
            </div>
            <button
              onClick={() => set({ webSearch: !settings.webSearch })}
              className={`relative flex-none w-11 h-6 rounded-full transition-colors ${
                settings.webSearch ? 'bg-app-accent' : 'bg-gray-400 dark:bg-night-700'
              }`}
              role="switch"
              aria-checked={settings.webSearch}
            >
              <span
                className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform"
                style={{
                  transform: settings.webSearch ? 'translateX(20px)' : 'translateX(0)',
                }}
              />
            </button>
          </div>

          {/* ── Kimlik ───────────────────────────────────── */}
          <div>
            <label className={label}>Asistan Adı</label>
            <input
              type="text"
              value={settings.assistantName}
              onChange={(e) => set({ assistantName: e.target.value })}
              className={field}
              placeholder="Chloe"
            />
          </div>
          <div>
            <label className={label}>Senin Adın (asistan hatırlasın)</label>
            <input
              type="text"
              value={settings.userName}
              onChange={(e) => set({ userName: e.target.value })}
              className={field}
              placeholder="Adın"
            />
          </div>

          {/* ── Tema ─────────────────────────────────────── */}
          <div>
            <span className={label}>Tema</span>
            <div className="flex gap-2">
              {(
                [
                  ['dark', '🌙 Karanlık'],
                  ['black', '⬛ Siyah'],
                  ['light', '☀️ Beyaz'],
                ] as [Theme, string][]
              ).map(([t, name]) => (
                <button
                  key={t}
                  onClick={() => set({ theme: t })}
                  aria-pressed={settings.theme === t}
                  className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    settings.theme === t
                      ? 'bg-app-accent text-app-on-accent border-app-accent'
                      : 'bg-white dark:bg-night-800 border-gray-300 dark:border-night-700 text-gray-700 dark:text-gray-300 hover:border-app-accent'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>

          {connectionStatus && (
            <p
              role="status"
              className={`rounded-lg border p-3 text-sm ${
                connectionStatus.kind === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                  : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
              }`}
            >
              {connectionStatus.message}
            </p>
          )}
          {settings.cloudProvider === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={saveCustomProvider}
                className="rounded-lg border border-gray-300 px-4 py-3 font-medium text-gray-700 hover:border-app-accent dark:border-night-700 dark:text-gray-200"
              >
                Bağlantıyı Kaydet
              </button>
              <button
                type="button"
                onClick={deleteCustomProvider}
                disabled={!settings.selectedCustomProviderId}
                className="rounded-lg border border-red-500/40 px-4 py-3 font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-40 dark:text-red-300"
              >
                Profili Sil
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={testConnection}
              disabled={testingConnection}
              className="rounded-lg border border-app-accent px-4 py-3 font-medium text-app-accent transition-colors hover:bg-app-accent/10 disabled:cursor-wait disabled:opacity-60 dark:text-app-accent"
            >
              {testingConnection ? 'Bağlantı deneniyor…' : 'Bağlantıyı Dene'}
            </button>
            <button
              onClick={async () => { if (await flushSettings()) onClose(); }}
              className="rounded-lg bg-app-accent py-3 font-medium text-app-on-accent transition-colors hover:bg-app-accent"
            >
              Kaydet
            </button>
          </div>
          <p className="text-center text-xs text-gray-500 dark:text-gray-400">
            Bağlantı testi sağlayıcına tek bir kısa istek gönderir; kullanım ücretine tabi olabilir.
          </p>
        </div>
      </div>
    </div>
  );
}
