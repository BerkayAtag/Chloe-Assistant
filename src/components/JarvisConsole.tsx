'use client';
import EmailConnect from '@/components/EmailConnect';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AudioLines,
  CalendarDays,
  Check,
  ChevronLeft,
  ExternalLink,
  LoaderCircle,
  Mail,
  Maximize2,
  Minimize2,
  Mic,
  MicOff,
  Settings2,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  X,
  Square,
  Users,
} from 'lucide-react';
import type { JarvisVoiceTone, Settings } from '@/lib/settings';
import VoiceOrb from '@/components/VoiceOrb';
import JarvisSettingsModal from '@/components/JarvisSettingsModal';
import { jarvisSpeechSettings } from '@/lib/jarvis-model';
import type { FemaleSpeechVoice } from '@/hooks/useVoice';

type Integration = {
  provider: 'google' | 'microsoft';
  name: string;
  email: string | null;
  connected: boolean;
  configured: boolean;
  setupMessage?: string;
  callbackUrl: string;
};

type MailItem = {
  id: string;
  from: string;
  subject: string;
  date: string;
  preview: string;
};

type CalendarItem = {
  id: string;
  title: string;
  start: string;
  end: string;
  location: string;
  url: string;
};

type JarvisConsoleProps = {
  settings: Settings;
  assistantName: string;
  /** Chloe's portrait (or the user's custom avatar) shown in the header. */
  avatarSrc?: string;
  modelName: string;
  isListening: boolean;
  isStarting: boolean;
  isSpeaking: boolean;
  isPreparingSpeech: boolean;
  onCancel: () => void;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onOpenOffice: () => void;
  workPanel?: ReactNode;
  timing?: { firstTokenMs?: number; totalMs?: number; audioStartMs?: number; servedModel?: string; connection?: string };
  speechIsOnDevice: boolean | null;
  isThinking: boolean;
  speechSupported: boolean;
  transcript: string;
  lastResponse: string;
  error: string | null;
  onExit: () => void;
  onToggleMic: () => void;
  onFinishListening: () => void;
  onOpenVoiceSettings: (kind: 'speech' | 'microphone') => void;
  onToggleVoice: () => void;
  voiceEnabled: boolean;
  handsFree: boolean;
  onToggleHandsFree: () => void;
  onSendText: (text: string) => void;
  onOpenSettings: () => void;
  femaleVoices: FemaleSpeechVoice[];
  selectedVoiceURI: string;
  voiceTone: JarvisVoiceTone;
  onVoiceChange: (voiceURI: string) => void;
  onVoiceToneChange: (tone: JarvisVoiceTone) => void;
  onPreviewVoice: () => void;
};

const STATE_LABELS = {
  listening: 'Seni dinliyorum',
  thinking: 'Düşünüyorum',
  speaking: 'Yanıtlıyorum',
  starting: 'Mikrofon açılıyor',
  ready: 'Hazırım',
  preparing: 'Ses hazırlanıyor',
} as const;

export default function JarvisConsole({
  settings,
  assistantName,
  avatarSrc = '/chloe-portrait.jpg',
  modelName,
  isListening,
  isStarting,
  isSpeaking,
  isPreparingSpeech,
  onCancel,
  onSettingsChange,
  onOpenOffice,
  workPanel,
  timing,
  isThinking,
  speechSupported,
  transcript,
  lastResponse,
  error,
  onExit,
  onToggleMic,
  onFinishListening,
  onOpenVoiceSettings,
  onToggleVoice,
  voiceEnabled,
  handsFree,
  onToggleHandsFree,
  onSendText,
  onOpenSettings,
  femaleVoices,
  selectedVoiceURI,
  voiceTone,
  onVoiceChange,
  onVoiceToneChange,
  onPreviewVoice,
}: JarvisConsoleProps) {
  const [panel, setPanel] = useState<'voice' | 'integrations' | 'mail' | 'calendar'>('voice');
  const [focusMode, setFocusMode] = useState(false);
  const [showJarvisSettings, setShowJarvisSettings] = useState(false);
  const cloudVoice = settings.jarvisSpeechEngine !== 'device';
  const speechResolution = jarvisSpeechSettings(settings);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [integrationRefresh, setIntegrationRefresh] = useState(0);
  const [loadingIntegrations, setLoadingIntegrations] = useState(false);
  const [integrationError, setIntegrationError] = useState('');
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [typedMessage, setTypedMessage] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<Integration['provider'] | ''>('');
  const [mailItems, setMailItems] = useState<MailItem[]>([]);
  const [mailQuery, setMailQuery] = useState('');
  const [mailBusy, setMailBusy] = useState(false);
  const [mailError, setMailError] = useState('');
  const [draft, setDraft] = useState<{ id: string; to: string; subject: string; body: string } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [calendarItems, setCalendarItems] = useState<CalendarItem[]>([]);
  const [calendarBusy, setCalendarBusy] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [calendarTitle, setCalendarTitle] = useState('');
  const [calendarStart, setCalendarStart] = useState('');
  const [calendarEnd, setCalendarEnd] = useState('');
  const [calendarLocation, setCalendarLocation] = useState('');
  const [calendarDescription, setCalendarDescription] = useState('');
  const [calendarPreview, setCalendarPreview] = useState(false);
  const connectedProviders = integrations.filter((integration) => integration.connected);

  const state = isSpeaking
    ? 'speaking'
    : isListening
      ? 'listening'
      : isThinking
        ? 'thinking'
        : isPreparingSpeech
          ? 'preparing'
        : isStarting
          ? 'starting'
        : 'ready';

  useEffect(() => {
    if (panel !== 'integrations' && panel !== 'mail' && panel !== 'calendar') return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setLoadingIntegrations(true);
      setIntegrationError('');
      void fetch('/api/integrations', { cache: 'no-store' })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Bağlantı listesi alınamadı.');
          if (!cancelled) {
            const nextIntegrations = data.integrations || [];
            setIntegrations(nextIntegrations);
            const selected = nextIntegrations.find(
              (item: Integration) => item.connected && item.provider === selectedProvider
            ) || nextIntegrations.find((item: Integration) => item.connected);
            if (selected) setSelectedProvider(selected.provider);
          }
        })
        .catch((cause: unknown) => {
          if (!cancelled) {
            setIntegrationError(cause instanceof Error ? cause.message : 'Bağlantı listesi alınamadı.');
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingIntegrations(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [panel, selectedProvider, integrationRefresh]);

  useEffect(() => {
    const refresh = () => setIntegrationRefresh((value) => value + 1);
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get('jarvis');
    if (!result) return;
    const timer = window.setTimeout(() => {
      if (result === 'connected') setPanel('integrations');
      if (result.startsWith('error:')) setIntegrationError(result.slice(6));
    }, 0);
    window.history.replaceState({}, '', window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (panel !== 'mail' || !selectedProvider) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setMailBusy(true);
      setMailError('');
      void fetch(`/api/integrations/${selectedProvider}/mail?q=${encodeURIComponent(mailQuery)}`, {
        cache: 'no-store',
      })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'E-postalar alınamadı.');
          if (!cancelled) setMailItems(data.messages || []);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setMailError(cause instanceof Error ? cause.message : 'E-postalar alınamadı.');
        })
        .finally(() => {
          if (!cancelled) setMailBusy(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mailQuery, panel, selectedProvider]);

  useEffect(() => {
    if (panel !== 'calendar' || !selectedProvider) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setCalendarBusy(true);
      setCalendarError('');
      void fetch(`/api/integrations/${selectedProvider}/calendar`, { cache: 'no-store' })
        .then(async (response) => {
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Takvim alınamadı.');
          if (!cancelled) setCalendarItems(data.events || []);
        })
        .catch((cause: unknown) => {
          if (!cancelled) setCalendarError(cause instanceof Error ? cause.message : 'Takvim alınamadı.');
        })
        .finally(() => {
          if (!cancelled) setCalendarBusy(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [panel, selectedProvider]);

  const createDraft = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProvider) return;
    setMailBusy(true);
    setMailError('');
    try {
      const response = await fetch(`/api/integrations/${selectedProvider}/mail`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, body: composeBody }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Taslak kaydedilemedi.');
      setDraft({ id: data.draftId, to: composeTo, subject: composeSubject, body: composeBody });
      setConfirmSend(false);
    } catch (cause: unknown) {
      setMailError(cause instanceof Error ? cause.message : 'Taslak kaydedilemedi.');
    } finally {
      setMailBusy(false);
    }
  };

  const sendDraft = async () => {
    if (!selectedProvider || !draft) return;
    if (!confirmSend) {
      setConfirmSend(true);
      return;
    }
    setMailBusy(true);
    setMailError('');
    try {
      const response = await fetch(`/api/integrations/${selectedProvider}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: draft.id, confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'E-posta gönderilemedi.');
      setDraft(null);
      setConfirmSend(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setMailError('E-posta gönderildi.');
    } catch (cause: unknown) {
      setMailError(cause instanceof Error ? cause.message : 'E-posta gönderilemedi.');
    } finally {
      setMailBusy(false);
    }
  };

  const createCalendarEvent = async () => {
    if (!selectedProvider) return;
    if (!calendarPreview) {
      setCalendarPreview(true);
      return;
    }
    setCalendarBusy(true);
    setCalendarError('');
    try {
      const response = await fetch(`/api/integrations/${selectedProvider}/calendar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: calendarTitle,
          start: new Date(calendarStart).toISOString(),
          end: new Date(calendarEnd).toISOString(),
          location: calendarLocation,
          description: calendarDescription,
          confirm: true,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Etkinlik oluşturulamadı.');
      setCalendarPreview(false);
      setCalendarTitle('');
      setCalendarStart('');
      setCalendarEnd('');
      setCalendarLocation('');
      setCalendarDescription('');
      setCalendarError('Takvim etkinliği oluşturuldu.');
      const refresh = await fetch(`/api/integrations/${selectedProvider}/calendar`, { cache: 'no-store' });
      const refreshed = await refresh.json();
      if (refresh.ok) setCalendarItems(refreshed.events || []);
    } catch (cause: unknown) {
      setCalendarError(cause instanceof Error ? cause.message : 'Etkinlik oluşturulamadı.');
    } finally {
      setCalendarBusy(false);
    }
  };

  const disconnect = async (provider: Integration['provider']) => {
    setDisconnecting(provider);
    setIntegrationError('');
    try {
      const response = await fetch(`/api/integrations/${provider}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Bağlantı kaldırılamadı.');
      setIntegrations((items) =>
        items.map((item) => item.provider === provider ? { ...item, connected: false, email: null } : item)
      );
    } catch (cause: unknown) {
      setIntegrationError(cause instanceof Error ? cause.message : 'Bağlantı kaldırılamadı.');
    } finally {
      setDisconnecting(null);
    }
  };

  return (
    <main className={`jarvis-console fixed inset-0 z-[60] flex h-dvh min-h-0 w-full flex-col overflow-hidden ${focusMode ? 'jarvis-focus' : ''}`}>
      <header className="jarvis-header">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={onExit}
            aria-label="Sohbete dön"
            className="rounded-xl border border-app-border bg-app-surface p-2.5 text-app-muted transition hover:border-app-accent/30 hover:text-app-text"
          >
            <ChevronLeft size={19} />
          </button>
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-app-accent/40 bg-app-accent-soft">
            {/* eslint-disable-next-line @next/next/no-img-element -- local portrait, same as the chat avatar */}
            <img src={avatarSrc} alt={assistantName} className="h-full w-full object-cover" draggable={false} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-wide">{assistantName} <span className="font-normal text-app-muted">/ JARVIS</span></div>
            <div className="truncate text-xs text-app-muted">{timing?.connection ? `Son yanıt: ${timing.connection}` : modelName}</div>
          </div>
        </div>

        <nav aria-label="Jarvis bölümleri" className="jarvis-nav flex items-center gap-1">
          <button type="button" onClick={onOpenOffice} aria-label="Ajan Ofisi" title="Ajan Ofisi" className="rounded-xl p-2.5 text-app-muted hover:text-app-text"><Users size={18}/></button>
          {([
            ['voice', 'Asistan', AudioLines],
            ['integrations', 'Bağlantılar', Settings2],
            ['mail', 'E-posta', Mail],
            ['calendar', 'Takvim', CalendarDays],
          ] as const).map(([id, title, Icon]) => (
            <button
              type="button"
              key={id}
              onClick={() => setPanel(id)}
              aria-label={title}
              aria-pressed={panel === id}
              className={`inline-flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm transition sm:px-3 ${panel === id ? 'bg-app-surface text-app-text' : 'text-app-muted hover:bg-app-surface hover:text-app-text'}`}
            >
              <Icon size={16} />
              <span className="hidden lg:inline">{title}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Model ve asistan ayarları"
            className="rounded-xl border border-app-border bg-app-surface p-2.5 text-app-muted transition hover:text-app-text"
          >
            <Sparkles size={17} />
          </button>
        </nav>
      </header>

      {panel === 'voice' ? (
        <section className="jarvis-voice">
          <div className="jarvis-hero">
            <div className="jarvis-status" role="status" aria-live="polite">{STATE_LABELS[state]}</div>
            <div className="jarvis-visual"><VoiceOrb state={state} theme={settings.theme} /></div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">
              {state === 'listening' ? 'Buradayım. Seni dinliyorum.' : state === 'thinking' ? 'Bir saniye…' : state === 'preparing' ? 'Sesin hazırlanıyor.' : state === 'speaking' ? 'Yanıtım geliyor.' : `Buradayım${settings.userName ? `, ${settings.userName}` : ''}.`}
            </h1>
            <p className="text-xs text-app-muted">{state === 'ready' ? 'Konuşmak için mikrofona dokun veya aşağıya yaz.' : state === 'starting' ? 'Mikrofon hazırlanıyor. Esc ile durdurabilirsin.' : '⌥ Space: mikrofon · Esc: durdur'}</p>
          </div>

          {!focusMode && (transcript || lastResponse) && (
            <div className="jarvis-transcript custom-scrollbar">
              {transcript && <p className="text-sm leading-6 text-app-muted"><span className="mr-2 font-medium">Sen</span>{transcript}</p>}
              {lastResponse && <p className="text-sm leading-6"><span className="mr-2 font-medium text-app-accent">{assistantName}</span>{lastResponse}</p>}
            </div>
          )}
          {!focusMode && timing && Object.keys(timing).length > 0 && <p className="jarvis-timing">
            {timing.connection && <span className="block">Yanıt bağlantısı: {timing.connection}</span>}
            {timing.firstTokenMs !== undefined && `İlk metin: ${(timing.firstTokenMs / 1000).toFixed(1)} sn · `}
            {timing.audioStartMs !== undefined && `İlk ses: ${(timing.audioStartMs / 1000).toFixed(1)} sn · `}
            {timing.totalMs !== undefined && `Metin tamamı: ${(timing.totalMs / 1000).toFixed(1)} sn`}
            {timing.servedModel && <span className="block">Aracının bildirdiği alt model: {timing.servedModel}</span>}
          </p>}
          {!focusMode && workPanel}
          {error && (
            <div role="alert" className="max-h-24 shrink-0 overflow-y-auto max-w-xl rounded-xl border border-app-danger/30 bg-app-danger-soft px-4 py-3 text-left text-sm text-app-danger">
              <p>{error}</p>
              {/izin|permission/iu.test(error) && (
                <button
                  type="button"
                  onClick={() => onOpenVoiceSettings(/mikrofon/iu.test(error) ? 'microphone' : 'speech')}
                  className="mt-2 rounded-lg border border-app-danger/30 px-3 py-1.5 text-xs font-medium hover:bg-app-surface"
                >
                  İzin ayarlarını aç
                </button>
              )}
            </div>
          )}


          <div className="jarvis-controls">
            <button type="button" onClick={onCancel} aria-label="Konuşmayı durdur" title="Konuşmayı durdur" className="rounded-full border border-app-border bg-app-surface p-3 text-app-muted"><Square size={18}/></button>
            <button type="button" onClick={onToggleMic} disabled={!speechSupported || isStarting}
              aria-label={isListening ? 'Dinlemeyi durdur' : isStarting ? 'Mikrofon açılıyor' : 'Konuşmaya başla'}
              className={`jarvis-mic-button ${isListening ? 'is-listening' : ''}`}>
              {isListening ? <MicOff size={23}/> : isStarting ? <LoaderCircle className="animate-spin" size={23}/> : <Mic size={23}/>}
            </button>
            <button type="button" onClick={onToggleVoice} aria-label={voiceEnabled ? 'Sesli yanıtı kapat' : 'Sesli yanıtı aç'} title={voiceEnabled ? 'Sesli yanıt açık' : 'Sesli yanıt kapalı'} className="rounded-full border border-app-border bg-app-surface p-3 text-app-muted">
              {voiceEnabled ? <Volume2 size={20}/> : <VolumeX size={20}/>}
            </button>
            <button type="button" onClick={() => setFocusMode(!focusMode)} aria-label={focusMode ? 'Odak görünümünden çık' : 'Küreyi büyüt'} aria-pressed={focusMode} title={focusMode ? 'Normal görünüm' : 'Odak görünümü'} className="rounded-full border border-app-border bg-app-surface p-3 text-app-muted">
              {focusMode ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}
            </button>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {isListening && <button type="button" onClick={onFinishListening}
              className="rounded-full bg-app-accent px-4 py-2 text-xs font-medium text-app-bg">
              Bitir ve gönder
            </button>}
            <button type="button" onClick={onToggleHandsFree} aria-pressed={handsFree}
              className={`rounded-full border px-3 py-1.5 text-xs ${handsFree ? 'border-app-accent bg-app-accent-soft text-app-accent' : 'border-app-border text-app-muted'}`}>
              {handsFree ? 'Sürekli dinleme açık' : 'Sürekli dinlemeyi aç'}
            </button>
            <span className="text-[11px] text-app-muted">Ses AI tarafından üretilir</span>
          </div>
          {!focusMode && (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <p className="text-[11px] text-app-muted">
                Ses: <span className="font-medium text-app-text">{cloudVoice ? (speechResolution.dedicated ? 'Yapay zeka sesi · ayrı API' : 'Yapay zeka sesi') : 'Cihaz sesi (çevrimdışı)'}</span>
                <span className="mx-1.5">·</span>
                Hızlı yanıt: <span className="font-medium text-app-text">{!settings.jarvisProvider || settings.jarvisProvider === 'inherit' ? 'Ana bağlantı' : 'Jarvis özel bağlantı'}</span>
              </p>
              <button
                type="button"
                onClick={() => setShowJarvisSettings(true)}
                className="inline-flex items-center gap-2 rounded-xl border border-app-border px-3 py-1.5 text-xs text-app-muted transition hover:bg-app-surface hover:text-app-text"
              >
                <Settings2 size={14} /> Jarvis ayarları
              </button>
            </div>
          )}
          <form className="jarvis-composer" onSubmit={(event) => {
            event.preventDefault();
            const clean = typedMessage.trim();
            if (!clean || isThinking) return;
            onSendText(clean);
            setTypedMessage('');
          }}>
            <input value={typedMessage} onChange={(event) => setTypedMessage(event.target.value)} disabled={isThinking}
              placeholder="JARVIS'e yaz..." aria-label="JARVIS mesajı"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-app-text outline-none placeholder:text-app-muted disabled:opacity-50"/>
            <button type="submit" disabled={!typedMessage.trim() || isThinking} aria-label="Mesajı gönder"
              className="rounded-xl bg-app-accent p-2.5 text-app-on-accent disabled:opacity-40"><Send size={17}/></button>
          </form>
          {!speechSupported && <p className="text-xs text-app-warning">Bu ortamda ses tanıma bulunamadı. Buradan yazarak devam edebilirsin.</p>}
          <JarvisSettingsModal
            isOpen={showJarvisSettings}
            onClose={() => setShowJarvisSettings(false)}
            settings={settings}
            onSettingsChange={onSettingsChange}
            femaleVoices={femaleVoices}
            selectedVoiceURI={selectedVoiceURI}
            voiceTone={voiceTone}
            onVoiceChange={onVoiceChange}
            onVoiceToneChange={onVoiceToneChange}
            onPreviewVoice={onPreviewVoice}
            onOpenVoiceSettings={onOpenVoiceSettings}
            onCancelSpeech={onCancel}
          />
        </section>
      ) : panel === 'integrations' ? (
        <section className="relative z-10 mx-auto w-full max-w-5xl flex-1 overflow-y-auto px-5 py-8 md:px-10">
          <div className="mb-7 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-app-accent">JARVIS WORKSPACE</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Bağlantılar</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-app-muted">E-posta ve takvim hesaplarını bağla. E-posta gönderimi ve takvim değişiklikleri ayrıca kullanıcı onayı ister.</p>
            </div>
            <button
              type="button"
              onClick={() => setPanel('voice')}
              className="hidden items-center gap-2 rounded-xl border border-app-border px-3 py-2 text-sm text-app-muted hover:bg-app-surface sm:inline-flex"
            >
              <Mic size={16} /> Asistana dön
            </button>
          </div>

          {integrationError && <div role="alert" className="mb-5 rounded-xl border border-app-danger/30 bg-app-danger-soft p-3 text-sm text-app-danger">{integrationError}</div>}
          <EmailConnect integrations={integrations} onUpdated={() => setIntegrationRefresh((value) => value + 1)}/>
          {loadingIntegrations ? (
            <div className="flex items-center gap-2 text-sm text-app-muted"><LoaderCircle className="animate-spin" size={18} /> Bağlantılar kontrol ediliyor…</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {integrations.map((integration) => {
                const Icon = integration.provider === 'google' ? Mail : CalendarDays;
                return (
                  <article key={integration.provider} className="rounded-3xl border border-app-border bg-app-surface p-5 backdrop-blur-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-app-border bg-app-surface text-app-text"><Icon size={20} /></div>
                        <div>
                          <h2 className="font-semibold">{integration.name}</h2>
                          <p className="mt-0.5 text-xs text-app-muted">{integration.email || 'E-posta ve takvim'}</p>
                        </div>
                      </div>
                      <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${integration.connected ? 'border-app-accent/30 bg-app-accent-soft text-app-accent' : 'border-app-border text-app-muted'}`}>
                        {integration.connected ? 'Bağlı' : integration.configured ? 'Hazır' : 'Kurulum gerekli'}
                      </span>
                    </div>
                    <div className="mt-5 rounded-2xl border border-app-border bg-app-surface p-3.5 text-xs leading-5 text-app-muted">
                      <div className="flex items-start gap-2.5">
                        <ShieldCheck size={15} className="mt-0.5 shrink-0 text-app-accent" />
                        <span>Mesajları bulma ve taslak hazırlama. Gönderme ya da takvimde değişiklik için ayrıca onay gerekir.</span>
                      </div>
                    </div>
                    {integration.setupMessage && !integration.configured && (
                      <div className="mt-3 rounded-xl border border-app-warning/30 bg-app-warning/5 p-3">
                        <p className="text-xs leading-5 text-app-warning">Yukarıdaki bir defalık uygulama kurulumunu tamamla; ardından e-posta adresinle bağlanabilirsin.</p>
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer font-medium">Geliştiriciler için alternatif .env kurulumu</summary>
                          <div className="mt-2 space-y-2 leading-5 text-app-muted">
                            <p>{integration.setupMessage}</p>
                            <p>Proje kökündeki `.env.local` dosyasına OAuth uygulama değerlerini ekle; gerçek anahtarları bu ekrana veya sohbete yapıştırma:</p>
                            <pre className="overflow-x-auto rounded-lg border border-app-border bg-app-surface p-2">{`${
                              integration.provider === 'google'
                                ? 'GOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET='
                                : 'MICROSOFT_CLIENT_ID=\nMICROSOFT_CLIENT_SECRET='
                            }\nJARVIS_TOKEN_ENCRYPTION_KEY=`}</pre>
                            <p>`JARVIS_TOKEN_ENCRYPTION_KEY` için Terminal&apos;de `openssl rand -base64 32` çalıştır. OAuth uygulamasında aşağıdaki Web callback URI&apos;sini tam olarak kaydet:</p>
                            <code className="block break-all rounded-lg border border-app-border bg-app-surface p-2">{integration.callbackUrl}</code>
                            <p>Sağlayıcı konsolunda Gmail/Calendar veya Outlook/Microsoft Graph izinlerini açıp kendi hesabını test kullanıcısı olarak ekle. `.env.local` kaydından sonra `./script/build_and_run.sh` ile Chloe sunucusunu yenile; masaüstü uygulamasını kapatman gerekmez.</p>
                          </div>
                        </details>
                      </div>
                    )}
                    <div className="mt-4 flex gap-2">
                      {integration.connected ? (
                        <button
                          type="button"
                          onClick={() => void disconnect(integration.provider)}
                          disabled={disconnecting === integration.provider}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-app-border px-3 py-2.5 text-sm text-app-muted hover:bg-app-surface disabled:opacity-50"
                        >
                          {disconnecting === integration.provider ? <LoaderCircle size={15} className="animate-spin" /> : <X size={15} />}
                          Bağlantıyı kaldır
                        </button>
                      ) : (
                        <a
                          href={`/api/integrations/connect/${integration.provider}`}
                          target="_blank" rel="noreferrer"
                          aria-disabled={!integration.configured}
                          onClick={(event) => {
                            if (!integration.configured) {
                              event.preventDefault();
                              setIntegrationError(integration.setupMessage || 'Önce OAuth kurulumu tamamlanmalı.');
                            }
                          }}
                          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${integration.configured ? 'bg-app-accent text-app-on-accent hover:bg-app-accent' : 'cursor-not-allowed bg-app-surface text-app-muted'}`}
                        >
                          Bağla <ExternalLink size={15} />
                        </a>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-7 rounded-3xl border border-app-border bg-app-surface p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-app-accent-soft p-2 text-app-accent"><Check size={17} /></div>
              <div>
                <h3 className="text-sm font-semibold">Güvenli işlem ilkesi</h3>
                <p className="mt-1 text-sm leading-6 text-app-muted">JARVIS bir e-posta veya takvim işlemi hazırladığında, alıcıyı ve içeriği önce sana gösterir. Sen onaylamadan hiçbir mesaj gönderilmez ve etkinlik oluşturulmaz.</p>
              </div>
            </div>
          </div>
        </section>
      ) : panel === 'mail' ? (
        <section className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 min-h-0 gap-5 overflow-y-auto px-5 py-6 lg:grid-cols-[1.1fr_0.9fr] md:px-10">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-app-accent">MAIL CENTER</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">E-posta</h1>
                <p className="mt-2 text-sm text-app-muted">Gelen kutunda ara; gönderimden önce taslağı incele.</p>
              </div>
              {connectedProviders.length > 0 && (
                <select
                  aria-label="E-posta hesabı"
                  value={selectedProvider}
                  onChange={(event) => setSelectedProvider(event.target.value as Integration['provider'])}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text"
                >
                  {connectedProviders.map((item) => <option key={item.provider} value={item.provider}>{item.email}</option>)}
                </select>
              )}
            </div>
            {!connectedProviders.length ? (
              <div className="rounded-3xl border border-app-border bg-app-surface p-6">
                <Mail className="mb-4 text-app-accent" size={24} />
                <h2 className="text-lg font-semibold">Önce e-posta hesabını bağla</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-app-muted">Bağlantılar bölümünden Gmail veya Outlook hesabını OAuth ile ekle. Şifre veya API anahtarı Chloe’ye verilmez.</p>
                <button type="button" onClick={() => setPanel('integrations')} className="mt-5 rounded-xl bg-app-accent px-4 py-2.5 text-sm font-semibold text-app-on-accent hover:bg-app-accent">Bağlantıları aç</button>
              </div>
            ) : (
              <>
                <form
                  className="mb-4 flex gap-2 rounded-2xl border border-app-border bg-app-surface p-2"
                  onSubmit={(event) => { event.preventDefault(); setMailQuery((query) => query.trim()); }}
                >
                  <input value={mailQuery} onChange={(event) => setMailQuery(event.target.value)} aria-label="E-postada ara" placeholder="Gelen kutusunda ara..." className="min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-app-muted" />
                  <button type="submit" aria-label="E-postaları ara" className="rounded-xl bg-app-surface px-4 py-2 text-sm hover:bg-app-surface">Ara</button>
                </form>
                {mailError && <div role="status" className={`mb-3 rounded-xl border p-3 text-sm ${mailError === 'E-posta gönderildi.' ? 'border-app-accent/30 text-app-accent' : 'border-app-danger/30 text-app-danger'}`}>{mailError}</div>}
                {mailBusy ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-app-muted"><LoaderCircle size={18} className="animate-spin" /> Gelen kutusu yükleniyor…</div>
                ) : (
                  <div className="space-y-2">
                    {mailItems.map((item) => (
                      <article key={item.id} className="rounded-2xl border border-app-border bg-app-surface p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <h2 className="truncate text-sm font-semibold">{item.subject}</h2>
                            <p className="mt-1 truncate text-xs text-app-accent">{item.from}</p>
                          </div>
                          <time className="shrink-0 text-[10px] text-app-muted">{item.date ? new Date(item.date).toLocaleDateString() : ''}</time>
                        </div>
                        <p className="mt-3 line-clamp-2 text-xs leading-5 text-app-muted">{item.preview}</p>
                      </article>
                    ))}
                    {!mailItems.length && <p className="rounded-2xl border border-app-border p-5 text-sm text-app-muted">Bu aramada e-posta bulunamadı.</p>}
                  </div>
                )}
              </>
            )}
          </div>

          <aside className="h-fit rounded-3xl border border-app-border bg-app-surface p-5">
            <div className="mb-4 flex items-center gap-2"><Mail size={17} className="text-app-accent" /><h2 className="font-semibold">Yeni e-posta</h2></div>
            <form className="space-y-3" onSubmit={createDraft}>
              <label className="block text-xs text-app-muted">Alıcılar (virgülle ayır)
                <input required type="text" autoComplete="email" value={composeTo} onChange={(event) => setComposeTo(event.target.value)} placeholder="ad@ornek.com" className="mt-1.5 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <label className="block text-xs text-app-muted">Konu
                <input required maxLength={200} value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <label className="block text-xs text-app-muted">Mesaj
                <textarea required maxLength={15000} rows={6} value={composeBody} onChange={(event) => setComposeBody(event.target.value)} className="mt-1.5 w-full resize-y rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm leading-6 text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <button disabled={mailBusy || !connectedProviders.length} type="submit" className="w-full rounded-xl bg-app-accent px-4 py-2.5 text-sm font-semibold text-app-on-accent hover:bg-app-accent disabled:opacity-40">
                {mailBusy ? 'Taslak kaydediliyor…' : 'Taslağı oluştur'}
              </button>
            </form>
            {draft && (
              <div className="mt-4 rounded-2xl border border-app-warning/30 bg-app-warning/10 p-4">
                <div className="text-xs font-semibold uppercase tracking-wider text-app-warning">Göndermeden önce incele</div>
                <p className="mt-3 text-xs text-app-muted">Kime: <span className="text-app-text">{draft.to}</span></p>
                <p className="mt-1 text-xs text-app-muted">Konu: <span className="text-app-text">{draft.subject}</span></p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-app-text">{draft.body}</p>
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => { setDraft(null); setConfirmSend(false); }} className="flex-1 rounded-xl border border-app-border px-3 py-2 text-xs text-app-muted">Vazgeç</button>
                  <button type="button" onClick={() => void sendDraft()} disabled={mailBusy} className={`flex-1 rounded-xl px-3 py-2 text-xs font-semibold ${confirmSend ? 'bg-app-danger-soft text-app-on-accent' : 'bg-app-warning text-app-on-accent'}`}>
                    {confirmSend ? 'Evet, şimdi gönder' : 'Göndermeyi onayla'}
                  </button>
                </div>
              </div>
            )}
          </aside>
        </section>
      ) : (
        <section className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 min-h-0 gap-5 overflow-y-auto px-5 py-6 lg:grid-cols-[1.1fr_0.9fr] md:px-10">
          <div className="min-w-0">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-app-accent">SCHEDULE</p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">Takvim</h1>
                <p className="mt-2 text-sm text-app-muted">Önümüzdeki 14 gün. Yeni etkinlik eklemeden önce özeti onayla.</p>
              </div>
              {connectedProviders.length > 0 && (
                <select
                  aria-label="Takvim hesabı"
                  value={selectedProvider}
                  onChange={(event) => setSelectedProvider(event.target.value as Integration['provider'])}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text"
                >
                  {connectedProviders.map((item) => <option key={item.provider} value={item.provider}>{item.email}</option>)}
                </select>
              )}
            </div>
            {!connectedProviders.length ? (
              <div className="rounded-3xl border border-app-border bg-app-surface p-6">
                <CalendarDays className="mb-4 text-app-accent" size={24} />
                <h2 className="text-lg font-semibold">Önce bir takvim hesabı bağla</h2>
                <p className="mt-2 text-sm leading-6 text-app-muted">Google Takvim ve Microsoft Outlook takvimi desteklenir.</p>
                <button type="button" onClick={() => setPanel('integrations')} className="mt-5 rounded-xl bg-app-accent px-4 py-2.5 text-sm font-semibold text-app-on-accent">Bağlantıları aç</button>
              </div>
            ) : calendarBusy ? (
              <div className="flex items-center gap-2 py-8 text-sm text-app-muted"><LoaderCircle size={18} className="animate-spin" /> Takvim yükleniyor…</div>
            ) : (
              <div className="space-y-2">
                {calendarItems.map((item) => (
                  <article key={item.id} className="rounded-2xl border border-app-border bg-app-surface p-4">
                    <h2 className="text-sm font-semibold">{item.title}</h2>
                    <p className="mt-1 text-xs text-app-accent">{item.start ? new Date(item.start).toLocaleString() : 'Tüm gün'}{item.end ? ` — ${new Date(item.end).toLocaleTimeString()}` : ''}</p>
                    {item.location && <p className="mt-1 text-xs text-app-muted">{item.location}</p>}
                  </article>
                ))}
                {!calendarItems.length && <p className="rounded-2xl border border-app-border p-5 text-sm text-app-muted">Önümüzdeki 14 günde etkinlik bulunamadı.</p>}
              </div>
            )}
            {calendarError && <div role="status" className="mt-3 rounded-xl border border-app-accent/30 p-3 text-sm text-app-accent">{calendarError}</div>}
          </div>

          <aside className="h-fit rounded-3xl border border-app-border bg-app-surface p-5">
            <div className="mb-4 flex items-center gap-2"><CalendarDays size={17} className="text-app-accent" /><h2 className="font-semibold">Etkinlik ekle</h2></div>
            <div className="space-y-3">
              <label className="block text-xs text-app-muted">Başlık
                <input required maxLength={200} value={calendarTitle} onChange={(event) => { setCalendarTitle(event.target.value); setCalendarPreview(false); }} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <label className="block text-xs text-app-muted">Başlangıç
                <input required type="datetime-local" value={calendarStart} onChange={(event) => { setCalendarStart(event.target.value); setCalendarPreview(false); }} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <label className="block text-xs text-app-muted">Bitiş
                <input required type="datetime-local" value={calendarEnd} onChange={(event) => { setCalendarEnd(event.target.value); setCalendarPreview(false); }} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <label className="block text-xs text-app-muted">Konum (isteğe bağlı)
                <input maxLength={500} value={calendarLocation} onChange={(event) => { setCalendarLocation(event.target.value); setCalendarPreview(false); }} className="mt-1.5 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              <label className="block text-xs text-app-muted">Açıklama (isteğe bağlı)
                <textarea maxLength={5000} rows={3} value={calendarDescription} onChange={(event) => { setCalendarDescription(event.target.value); setCalendarPreview(false); }} className="mt-1.5 w-full resize-y rounded-xl border border-app-border bg-app-surface px-3 py-2.5 text-sm text-app-text outline-none focus:border-app-accent/30" />
              </label>
              {calendarPreview && (
                <div className="rounded-xl border border-app-warning/30 bg-app-warning/10 p-3 text-xs leading-5 text-app-warning">
                  <strong>Onayla:</strong> {calendarTitle} · {calendarStart ? new Date(calendarStart).toLocaleString() : 'başlangıç seçilmedi'} – {calendarEnd ? new Date(calendarEnd).toLocaleString() : 'bitiş seçilmedi'}
                </div>
              )}
              <button
                type="button"
                disabled={calendarBusy || !connectedProviders.length || !calendarTitle || !calendarStart || !calendarEnd}
                onClick={() => void createCalendarEvent()}
                className={`w-full rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-40 ${calendarPreview ? 'bg-app-warning text-app-on-accent' : 'bg-app-accent text-app-on-accent'}`}
              >
                {calendarBusy ? 'Kaydediliyor…' : calendarPreview ? 'Etkinliği onayla ve oluştur' : 'Önizleme'}
              </button>
            </div>
          </aside>
        </section>
      )}
      {panel !== 'voice' && (
        <footer className="relative z-10 flex items-center justify-between border-t border-app-border px-5 py-3 text-[10px] text-app-muted md:px-9">
          <span>CHLOE / JARVIS MODE</span>
          <span>Hesap bağlantıları cihazındaki Chloe sunucusunda saklanır.</span>
        </footer>
      )}
    </main>
  );
}
