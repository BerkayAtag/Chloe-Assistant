'use client';
import { X, Zap, Cloud, HardDrive, CheckCircle2, AlertTriangle, Volume2, MessageSquare, Mic, Play, ShieldAlert } from 'lucide-react';
import { providerName, type Settings, type JarvisVoiceTone, type JarvisSpeechProvider, type JarvisProvider } from '@/lib/settings';
import { jarvisModelIssue, jarvisSpeechSettings } from '@/lib/jarvis-model';
import type { FemaleSpeechVoice } from '@/hooks/useVoice';

/**
 * Jarvis ayarları tek bir modern panelde toplanır: ses motoru, hızlı sohbet
 * bağlantısı, ses (TTS) bağlantısı ve konuşma davranışı. Ana ekranın ortasında
 * ayar kalabalığı bırakmamak için ayrı bir modal olarak açılır.
 */
export default function JarvisSettingsModal({
  isOpen,
  onClose,
  settings,
  onSettingsChange,
  femaleVoices,
  selectedVoiceURI,
  voiceTone,
  onVoiceChange,
  onVoiceToneChange,
  onPreviewVoice,
  onOpenVoiceSettings,
  onCancelSpeech,
}: {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  femaleVoices: FemaleSpeechVoice[];
  selectedVoiceURI: string;
  voiceTone: JarvisVoiceTone;
  onVoiceChange: (voiceURI: string) => void;
  onVoiceToneChange: (tone: JarvisVoiceTone) => void;
  onPreviewVoice: () => void;
  onOpenVoiceSettings: (kind: 'speech' | 'microphone') => void;
  onCancelSpeech: () => void;
}) {
  if (!isOpen) return null;

  const cloudVoice = settings.jarvisSpeechEngine !== 'device';
  const speech = jarvisSpeechSettings(settings);
  const jarvisIssue = jarvisModelIssue(settings);
  // Ses listesi ETKİN ses bağlantısına göre belirlenir: ayrı ses API'si seçiliyse
  // onun sağlayıcısı, yoksa Jarvis/ana bağlantının ses üretebilen sağlayıcısı.
  const speechTarget = speech.settings;
  const geminiVoice = speechTarget.provider === 'cloud' && speechTarget.cloudProvider === 'gemini';
  const cloudVoices = geminiVoice
    ? ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Zephyr', 'Achernar']
    : [...new Set([settings.customSpeechVoice || 'nova', 'nova', 'shimmer', 'alloy'])];
  const voiceOptions = cloudVoice
    ? cloudVoices.map((name) => ({ voiceURI: name, name }))
    : femaleVoices;
  const voiceModelLabel = speech.dedicated
    ? 'Ayrı ses API'
    : /freellm/i.test(providerName(settings)) || settings.cloudProvider === 'custom'
      ? 'Ana bağlantı'
      : providerName(settings);

  const badge = (kind: 'ok' | 'info' | 'warn', label: string) => {
    const palette = {
      ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500',
      info: 'border-app-border bg-app-surface text-app-muted',
      warn: 'border-app-warning/40 bg-app-warning/10 text-app-warning',
    }[kind];
    return (
      <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${palette}`}>
        {kind === 'ok' ? <CheckCircle2 size={12} /> : kind === 'warn' ? <AlertTriangle size={12} /> : null}
        {label}
      </span>
    );
  };

  const card = (active: boolean) =>
    `flex-1 cursor-pointer rounded-xl border p-3 text-left transition ${
      active ? 'border-app-accent bg-app-accent-soft' : 'border-app-border bg-app-surface hover:border-app-accent/40'
    }`;
  const field = 'w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-text outline-none focus:border-app-accent';
  const label = 'text-[11px] font-medium text-app-muted';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Jarvis ayarları">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-bg shadow-2xl">
        <header className="flex items-center justify-between border-b border-app-border px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-app-text">Jarvis Ayarları</h2>
            <p className="text-[11px] text-app-muted">Ses, hızlı yanıt ve konuşma davranışını buradan yönet.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat" className="rounded-lg p-2 text-app-muted hover:bg-app-surface hover:text-app-text">
            <X size={18} />
          </button>
        </header>

        <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* ── Özet: ne nereye bağlı ───────────────────────── */}
          <section className="rounded-xl border border-app-border bg-app-surface p-3">
            <p className={label}>Şu anki bağlantılar</p>
            <div className="mt-2 space-y-1.5 text-xs text-app-text">
              <div className="flex items-center gap-2">
                <MessageSquare size={14} className="text-app-muted" />
                <span className="text-app-muted">Sohbet ve internet:</span>
                <span className="font-medium">{providerName(settings)}</span>
              </div>
              <div className="flex items-center gap-2">
                <Zap size={14} className="text-app-muted" />
                <span className="text-app-muted">Jarvis hızlı yanıt:</span>
                <span className="font-medium">
                  {settings.jarvisProvider === 'inherit' || !settings.jarvisProvider
                    ? 'Ana bağlantı'
                    : `${settings.jarvisProvider === 'local' ? 'Yerel LLM' : settings.jarvisProvider === 'custom' ? 'Özel API' : settings.jarvisProvider === 'openai' ? 'OpenAI' : settings.jarvisProvider === 'anthropic' ? 'Claude' : 'Gemini'}${settings.jarvisApiKey?.trim() ? ' · ayrı anahtar' : ' · anahtar yok'}`}
                </span>
                {settings.jarvisProvider && settings.jarvisProvider !== 'inherit' && (settings.jarvisApiKey?.trim() || settings.jarvisProvider === 'local')
                  ? badge('ok', 'Bağlı')
                  : badge('info', 'Ana bağlantı')}
              </div>
              <div className="flex items-center gap-2">
                <Volume2 size={14} className="text-app-muted" />
                <span className="text-app-muted">Ses (konuşma):</span>
                <span className="font-medium">
                  {cloudVoice
                    ? settings.jarvisSpeechProvider !== 'inherit' && settings.jarvisSpeechApiKey?.trim()
                      ? `${voiceModelLabel} · ayrı anahtar`
                      : `${voiceModelLabel} ile üretilir`
                    : 'Cihaz sesi (çevrimdışı)'}
                </span>
                {cloudVoice && (speech.issue || !speechTarget.apiKey?.trim()) ? badge('warn', 'Eksik') : cloudVoice ? badge('info', 'Yapılandırıldı') : badge('info', 'Çevrimdışı')}
              </div>
            </div>
          </section>

          {/* ── 1. Ses motoru ───────────────────────────────── */}
          <section className="space-y-2">
            <div>
              <h3 className="text-sm font-semibold text-app-text">1 · Nasıl konuşsun?</h3>
              <p className="text-[11px] text-app-muted">Chloe&apos;nin sesini neyin üreteceğini seç.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { onCancelSpeech(); onSettingsChange({ jarvisSpeechEngine: 'main' }); }}
                className={card(cloudVoice)}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-app-text"><Cloud size={15} /> Yapay zeka sesi (bulut)</div>
                <p className="mt-1 text-[11px] leading-4 text-app-muted">
                  Doğal ve akıcı ses. Seçili <strong>ses bağlantısı</strong> kullanılır: {voiceModelLabel}.
                </p>
              </button>
              <button
                type="button"
                onClick={() => { onCancelSpeech(); onSettingsChange({ jarvisSpeechEngine: 'device' }); }}
                className={card(!cloudVoice)}
              >
                <div className="flex items-center gap-2 text-sm font-medium text-app-text"><HardDrive size={15} /> Cihaz sesi (çevrimdışı)</div>
                <p className="mt-1 text-[11px] leading-4 text-app-muted">
                  macOS&apos;in yüklü Türkçe sesi. İnternet gerekmez, anında başlar.
                </p>
              </button>
            </div>
            {cloudVoice && speech.issue && (
              <p className="rounded-lg border border-app-warning/40 bg-app-warning/10 px-3 py-2 text-[11px] text-app-warning">
                {speech.issue} Şimdilik ses ana bağlantıdan üretilir; aşağıdan ayrı bir ses API&apos;si bağlayabilirsin.
              </p>
            )}
          </section>

          {/* ── 2. Hızlı sohbet bağlantısı ──────────────────── */}
          <section className="space-y-2 rounded-xl border border-app-border bg-app-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-app-text">2 · Hızlı sohbet bağlantısı (Jarvis)</h3>
                <p className="text-[11px] text-app-muted">Jarvis modunda konuşurken yanıtı üreten model. Yavaşsa buraya hızlı bir API bağla.</p>
              </div>
              {settings.jarvisProvider && settings.jarvisProvider !== 'inherit' && settings.jarvisApiKey?.trim()
                ? badge('ok', 'Ayrı anahtar')
                : badge('info', 'Ana bağlantı')}
            </div>
            <label className="block space-y-1">
              <span className={label}>Sağlayıcı</span>
              <select
                aria-label="Jarvis sağlayıcısı"
                value={settings.jarvisProvider || 'inherit'}
                onChange={(e) => onSettingsChange({ jarvisProvider: e.target.value as JarvisProvider })}
                className={field}
              >
                <option value="inherit">Ana bağlantıyı kullan (önerilen)</option>
                <option value="gemini">Google Gemini — hızlı</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic Claude</option>
                <option value="custom">Özel API (OpenAI uyumlu)</option>
                <option value="local">Yerel LLM (Ollama)</option>
              </select>
            </label>
            {settings.jarvisProvider && settings.jarvisProvider !== 'inherit' && (
              <>
                {settings.jarvisProvider !== 'local' && (
                  <label className="block space-y-1">
                    <span className={label}>API anahtarı</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={settings.jarvisApiKey || ''}
                      onChange={(e) => onSettingsChange({ jarvisApiKey: e.target.value })}
                      placeholder="Yalnız Jarvis için kullanılacak anahtar"
                      className={field}
                    />
                  </label>
                )}
                <label className="block space-y-1">
                  <span className={label}>Model (boş bırakılırsa varsayılan)</span>
                  <input
                    type="text"
                    value={settings.jarvisModel || ''}
                    onChange={(e) => onSettingsChange({ jarvisModel: e.target.value })}
                    placeholder={settings.jarvisProvider === 'gemini' ? 'gemini-3.8-flash' : settings.jarvisProvider === 'openai' ? 'gpt-4o-mini' : settings.jarvisProvider === 'anthropic' ? 'claude-3-5-haiku-20241022' : settings.jarvisProvider === 'local' ? 'llama3.2:1b' : 'auto'}
                    className={field}
                  />
                </label>
                {['custom', 'local'].includes(settings.jarvisProvider) && (
                  <label className="block space-y-1">
                    <span className={label}>{settings.jarvisProvider === 'local' ? 'Ollama adresi' : 'API adresi (Base URL)'}</span>
                    <input
                      type="text"
                      value={settings.jarvisApiBaseUrl || ''}
                      onChange={(e) => onSettingsChange({ jarvisApiBaseUrl: e.target.value })}
                      placeholder={settings.jarvisProvider === 'local' ? 'http://127.0.0.1:11434/v1' : 'https://api.example.com/v1'}
                      className={field}
                    />
                  </label>
                )}
                {jarvisIssue && (
                  <p className="rounded-lg border border-app-warning/40 bg-app-warning/10 px-3 py-2 text-[11px] text-app-warning">⚠️ {jarvisIssue}</p>
                )}
              </>
            )}
          </section>

          {/* ── 3. Ses (TTS) bağlantısı ─────────────────────── */}
          <section className="space-y-2 rounded-xl border border-app-border bg-app-bg p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-app-text">3 · Ses (konuşma) bağlantısı</h3>
                <p className="text-[11px] text-app-muted">Konuşmayı sese çeviren API. Boş bırakırsan Jarvis/ana bağlantı kullanılır.</p>
              </div>
              {settings.jarvisSpeechProvider === 'inherit'
                ? badge('info', 'Varsayılan')
                : settings.jarvisSpeechApiKey?.trim() && (settings.jarvisSpeechProvider === 'gemini' || settings.jarvisSpeechApiBaseUrl?.trim())
                  ? badge('ok', 'Ayrı anahtar')
                  : badge('warn', 'Eksik')}
            </div>
            <label className="block space-y-1">
              <span className={label}>Ses sağlayıcısı</span>
              <select
                aria-label="Ses sağlayıcısı"
                value={settings.jarvisSpeechProvider || 'inherit'}
                onChange={(e) => onSettingsChange({ jarvisSpeechProvider: e.target.value as JarvisSpeechProvider })}
                className={field}
              >
                <option value="inherit">Varsayılan (Jarvis/ana bağlantı)</option>
                <option value="gemini">Google Gemini (doğal ses)</option>
                <option value="custom">Özel API (/audio/speech)</option>
              </select>
            </label>
            {settings.jarvisSpeechProvider && settings.jarvisSpeechProvider !== 'inherit' && (
              <>
                <label className="block space-y-1">
                  <span className={label}>Ses API anahtarı</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings.jarvisSpeechApiKey || ''}
                    onChange={(e) => onSettingsChange({ jarvisSpeechApiKey: e.target.value })}
                    placeholder={settings.jarvisSpeechProvider === 'gemini' ? 'Gemini API anahtarı' : 'Ses servisi anahtarı'}
                    className={field}
                  />
                </label>
                <label className="block space-y-1">
                  <span className={label}>Ses modeli (isteğe bağlı)</span>
                  <input
                    type="text"
                    value={settings.jarvisSpeechModel || ''}
                    onChange={(e) => onSettingsChange({ jarvisSpeechModel: e.target.value })}
                    placeholder={settings.jarvisSpeechProvider === 'gemini' ? 'gemini-3.8-flash-tts' : 'tts-1'}
                    className={field}
                  />
                </label>
                {settings.jarvisSpeechProvider === 'custom' && (
                  <label className="block space-y-1">
                    <span className={label}>Ses API adresi (Base URL)</span>
                    <input
                      type="text"
                      value={settings.jarvisSpeechApiBaseUrl || ''}
                      onChange={(e) => onSettingsChange({ jarvisSpeechApiBaseUrl: e.target.value })}
                      placeholder="https://api.openai.com/v1"
                      className={field}
                    />
                  </label>
                )}
              </>
            )}
          </section>

          {/* ── 4. Konuşma davranışı ────────────────────────── */}
          <section className="space-y-3 rounded-xl border border-app-border bg-app-bg p-3">
            <div>
              <h3 className="text-sm font-semibold text-app-text">4 · Konuşma davranışı</h3>
              <p className="text-[11px] text-app-muted">Ses tonu, hız ve asistanın konuşma tarzı.</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-40 flex-1 space-y-1">
                <span className={label}>{cloudVoice ? 'Ses' : 'Cihaz sesi'}</span>
                <select
                  value={cloudVoice
                    ? geminiVoice ? settings.jarvisCloudVoice : settings.customSpeechVoice
                    : femaleVoices.some((v) => v.voiceURI === selectedVoiceURI) ? selectedVoiceURI : femaleVoices[0]?.voiceURI || ''}
                  onChange={(event) => cloudVoice
                    ? onSettingsChange(geminiVoice ? { jarvisCloudVoice: event.target.value } : { customSpeechVoice: event.target.value })
                    : onVoiceChange(event.target.value)}
                  disabled={!voiceOptions.length}
                  aria-label="Konuşma sesi"
                  className={field}
                >
                  {voiceOptions.length
                    ? voiceOptions.map((voice) => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name}</option>)
                    : <option value="">Ses bulunamadı</option>}
                </select>
              </label>
              <div className="space-y-1">
                <span className={label}>Ton</span>
                <div className="flex gap-1" role="group" aria-label="Ses tonlaması">
                  {([['natural', 'Doğal'], ['warm', 'Sıcak'], ['calm', 'Sakin']] as [JarvisVoiceTone, string][]).map(([value, name]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => { onCancelSpeech(); onVoiceToneChange(value); }}
                      className={`rounded-lg border px-2.5 py-1.5 text-xs ${voiceTone === value ? 'border-app-accent bg-app-accent-soft text-app-accent' : 'border-app-border text-app-muted hover:text-app-text'}`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={onPreviewVoice}
                disabled={!voiceOptions.length}
                className="inline-flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:text-app-text disabled:opacity-40"
              >
                <Play size={14} /> Sesi dene
              </button>
            </div>
            <label className="flex items-center gap-2 text-xs text-app-text">
              <input
                type="checkbox"
                checked={settings.jarvisFastMode !== false}
                onChange={(event) => onSettingsChange({ jarvisFastMode: event.target.checked })}
              />
              Hızlı konuşma: kısa yanıt, sınırlı geçmiş, düşük düşünme süresi
            </label>
            <label className="block space-y-1">
              <span className={label}>Cümle sonu bekleme süresi</span>
              <select
                value={settings.jarvisSilenceMs}
                onChange={(event) => onSettingsChange({ jarvisSilenceMs: Number(event.target.value) })}
                className={field}
              >
                {[1500, 2000, 2500, 3000, 3500].map((milliseconds) => (
                  <option key={milliseconds} value={milliseconds}>{(milliseconds / 1000).toFixed(1)} saniye</option>
                ))}
              </select>
              <span className="block text-[11px] leading-4 text-app-muted">
                Kısa süre daha çabuk yanıt verir; uzun süre cümle içindeki duraklamalarda mikrofonun erken kapanmasını azaltır.
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-app-text">
              <input type="checkbox" checked={settings.jarvisAutoSend !== false}
                onChange={(event) => onSettingsChange({ jarvisAutoSend: event.target.checked })} />
              <span>Sessizlikten sonra otomatik gönder. Kapatırsan uzun talimatını
                bölmeden söyleyebilir, hazır olduğunda “Bitir ve gönder”e basabilirsin.</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-app-text">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.jarvisBargeIn === true}
                onChange={(event) => onSettingsChange({ jarvisBargeIn: event.target.checked })}
              />
              <span>
                Konuşurken sözümü kesebilsin <span className="text-app-muted">(deneysel)</span>
                <span className="block text-[11px] leading-4 text-app-muted">
                  Açıkken Chloe konuşurken sen konuşmaya başlarsan ses durur ve dinlemeye geçilir.
                  Mikrofon izni gerekir; yankıdan etkilenebileceği için varsayılan olarak kapalıdır.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-app-text">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.jarvisAudioCues !== false}
                onChange={(event) => onSettingsChange({ jarvisAudioCues: event.target.checked })}
              />
              <span>
                Mikrofon açılınca/kapanınca kısa ses sinyali ver
                <span className="block text-[11px] leading-4 text-app-muted">
                  Dinlemenin başladığını ve bittiğini duyarsın; mikrofonun ne zaman açık olduğu belirsiz kalmaz.
                </span>
              </span>
            </label>
            <label className="block space-y-1">
              <span className={label}>Nasıl konuşmamı istersin?</span>
              <textarea
                rows={3}
                maxLength={4000}
                value={settings.jarvisInstructions}
                onChange={(e) => onSettingsChange({ jarvisInstructions: e.target.value })}
                placeholder="Örn. Samimi ve sakin konuş. Kısa yanıt ver, gerektiğinde ayrıntıyı sor."
                className={field}
              />
            </label>
            {!cloudVoice && !femaleVoices.length && (
              <p className="rounded-lg border border-app-warning/40 bg-app-warning/10 px-3 py-2 text-[11px] text-app-warning">
                Bu cihazda tanınan Türkçe kadın sesi bulunamadı. Sistem ayarlarından Türkçe bir kadın sesi yükleyebilirsin.
              </p>
            )}
          </section>

          {/* ── 5. İzinler ─────────────────────────────────── */}
          <section className="rounded-xl border border-app-border bg-app-surface p-3">
            <p className={label}>İzinler ve sorun giderme</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => onOpenVoiceSettings('microphone')} className="inline-flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:text-app-text">
                <Mic size={14} /> Mikrofon izni
              </button>
              <button type="button" onClick={() => onOpenVoiceSettings('speech')} className="inline-flex items-center gap-1.5 rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-muted hover:text-app-text">
                <ShieldAlert size={14} /> Konuşma tanıma izni
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-app-muted">
              Konuşma tanıma, sistemine göre Apple veya tarayıcının ses hizmetini kullanır. Yalnızca tanınan metin
              seçtiğin modele gönderilir; ses bu uygulamada saklanmaz.
            </p>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-app-border px-5 py-3">
          <p className="text-[11px] text-app-muted">Anahtarlar şifreli kasada saklanır; sohbet ve internet işleri ana bağlantıda kalır.</p>
          <button type="button" onClick={onClose} className="rounded-lg bg-app-accent px-4 py-2 text-xs font-medium text-white hover:opacity-90">
            Tamam
          </button>
        </footer>
      </div>
    </div>
  );
}
