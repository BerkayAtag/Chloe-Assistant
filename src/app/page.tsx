'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import SettingsModal from '@/components/SettingsModal';
import JarvisConsole from '@/components/JarvisConsole';
import AgentOffice from '@/components/AgentOffice';
import CodeWorkspace from '@/components/CodeWorkspace';
import Avatar from '@/components/Avatar';
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Monitor,
  Code2,
  Mic,
  MicOff,
  Plus,
  Send,
  Square,
  Sparkles,
  Upload,
  Video,
  Globe,
  Volume2,
  VolumeX,
  X,
  AudioLines,
  Users,
} from 'lucide-react';
import { useVoice } from '@/hooks/useVoice';
import { useSettings, retrySettings } from '@/hooks/useSettings';
import { hasExplicitConnection, modelLabel, settingsForRequest, updateProviderSettings, type Settings } from '@/lib/settings';
import { sendNativeAction, useNativeMac } from '@/lib/native-bridge';
import { JarvisEventDecoder, type JarvisEvent } from '@/lib/jarvis-protocol';
import { useJarvisWork } from '@/hooks/useJarvisWork';
import JarvisWorkPanel from '@/components/JarvisWorkPanel';
import { jarvisEffectiveSettings } from '@/lib/jarvis-model';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url: string;
  dataUrl?: string;
  extractedText?: string;
}

type SelectedTool = 'browser' | 'computer' | 'codex' | 'image' | 'video';

function needsDetailedResearch(text: string): boolean {
  return /(detaylı|derinlemesine|kapsamlı|uzun araştır|çok çalış|öğren|uzmanlaş|kaynakları? incele|güncel (bilgi|durum)|araştır)/iu.test(
    text
  );
}

function browserSearchUrl(input: string): string {
  const candidate = input
    .replace(/^(?:browser|tarayıcı|web)\s*[:：]\s*/iu, '')
    .trim();
  const hasScheme = /^https?:\/\//iu.test(candidate);
  const looksLikeAddress =
    hasScheme ||
    /^www\./iu.test(candidate) ||
    /^(?:localhost|(?:[\w-]+\.)+[a-z]{2,})(?::\d+)?(?:\/\S*)?$/iu.test(candidate);
  if (!looksLikeAddress) {
    return `https://www.google.com/search?q=${encodeURIComponent(candidate)}`;
  }
  const address = hasScheme || candidate.startsWith('www.') ? candidate : `https://${candidate}`;
  try {
    const url = new URL(address);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export default function Home() {
  const [settings, setSettings, settingsReady, connectionStorage] = useSettings();
  const [speakEnabled, setSpeakEnabled] = useState(true);
  const [jarvisHandsFree, setJarvisHandsFree] = useState(false);
  const [resumeJarvisListening, setResumeJarvisListening] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const nativeMac = useNativeMac();
  const [officeOpen, setOfficeOpen] = useState(false);
  const [officeContext, setOfficeContext] = useState({ runId: '', workspace: '' });
  const [jarvisTiming, setJarvisTiming] = useState<{ firstTokenMs?: number; totalMs?: number; audioStartMs?: number; servedModel?: string; connection?: string }>({});

  const [input, setInput] = useState('');
  const [listeningText, setListeningText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [selectedTool, setSelectedTool] = useState<SelectedTool | null>(null);
  const [generator, setGenerator] = useState<{ type: 'image' | 'video'; editId?: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  // Avatar: {file, version} — model görseli değiştirince tazelenir
  const [avatar, setAvatar] = useState<{ file: string | null; version: number }>({
    file: null,
    version: 0,
  });

  const endOfMessagesRef = useRef<HTMLDivElement>(null);
  const micStartAtRef = useRef(0);
  // Barge-in (sesle kesme) davranışı: sendMessage'a döngüsel bağlanmamak için ref.
  const bargeInRef = useRef<() => void>(() => {});
  const requestControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { requestControllerRef.current?.abort(); }, [
    settings.provider, settings.cloudProvider, settings.apiKey, settings.apiBaseUrl,
    settings.cloudModel, settings.customModel, settings.ollamaUrl, settings.ollamaModel,
  ]);

  const voice = useVoice({
    lang: 'tr-TR',
    settings,
    onPartial: (text) => setListeningText(text),
  });
  const { startListening, sttSupported, error: voiceError } = voice;
  const jarvisWork = useJarvisWork(settings, settings.jarvisMode && !officeOpen);

  // Sunucudan kimliği senkronla (asistan/kullanıcı adı araçlarla değişebilir)
  useEffect(() => {
    fetch('/api/identity')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          setSettings((prev) => ({
            ...prev,
            assistantName: d.data.assistantName || prev.assistantName,
            userName: d.data.userName || prev.userName,
          }));
        }
      })
      .catch(() => {});
  }, [setSettings]);

  const refreshAvatar = useCallback(async () => {
    try {
      const res = await fetch('/api/avatar', { cache: 'no-store' });
      const data = await res.json();
      if (data.success && data.data) {
        setAvatar({ file: data.data.file, version: data.data.version || 0 });
      }
    } catch {}
  }, []);

  // İlk yüklemede avatar durumunu al (setState yalnızca await sonrası çalışır)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setAvatar await sonrası çalışır
    refreshAvatar();
  }, [refreshAvatar]);

  // Temayı uygula (dark = gece, black = saf siyah, light = beyaz)
  useEffect(() => {
    if (!settingsReady) return;
    const root = document.documentElement;
    root.classList.toggle('dark', settings.theme === 'dark' || settings.theme === 'black');
    root.classList.toggle('black', settings.theme === 'black');
  }, [settings.theme, settingsReady]);

  // Otomatik kaydırma
  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const syncIdentity = useCallback(() => {
    fetch('/api/identity')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data) {
          setSettings((prev) => ({
            ...prev,
            assistantName: d.data.assistantName || prev.assistantName,
            userName: d.data.userName || prev.userName,
          }));
        }
      })
      .catch(() => {});
  }, [setSettings]);

  const generateMedia = useCallback(async (prompt: string) => {
    if (!generator || !prompt.trim() || isGenerating) return;
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setIsGenerating(true);
    setErrorDetail(null);
    try {
      const source = generator.editId ? attachments.find((file) => file.id === generator.editId) : undefined;
      const response = await fetch('/api/generate', {
        method: 'POST',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(330000)]),
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: generator.type,
          prompt: prompt.trim(),
          imageData: source?.dataUrl,
          settings: settingsForRequest(settings),
        }),
      });
      const data = await response.json();
      if (controller.signal.aborted) return false;
      if (!response.ok) throw new Error(data.error || 'Medya üretilemedi.');
      setAttachments((previous) => [
        ...previous,
        { ...data.data, name: generator.type === 'image' ? 'Üretilen görsel' : 'Üretilen video', size: 0 },
      ]);
      return true;
    } catch (error) {
      if (controller.signal.aborted) { setErrorDetail('Medya yanıtını bekleme durduruldu. Sağlayıcıda başlamış üretim devam edebilir ve ücretlendirilebilir.'); return false; }
      setErrorDetail(error instanceof Error ? error.message : 'Medya üretilemedi.');
      return false;
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
      setIsGenerating(false);
    }
  }, [attachments, generator, isGenerating, settings]);

  const sendMessage = useCallback(
    async (text: string, forceJarvisMode = false, voiceTurn = false) => {
      const clean = text.trim();
      if ((!clean && attachments.length === 0) || isLoading || isGenerating || requestControllerRef.current) return;
      const jarvisRequest = settings.jarvisMode || forceJarvisMode;
      if (jarvisRequest) { voice.stopListening(); voice.stopSpeaking(); setResumeJarvisListening(false); setJarvisTiming({}); }
      if (jarvisRequest) {
        const notice = jarvisWork.route(clean);
        if (notice) {
          setInput(''); setListeningText(''); setErrorDetail(null);
          setMessages((previous) => [...previous, { role: 'user', content: clean }, { role: 'assistant', content: notice }]);
          if (speakEnabled) voice.speak(notice, { onEnd: () => setResumeJarvisListening(true) });
          else if (jarvisHandsFree) setResumeJarvisListening(true);
          return;
        }
      }
      if (!jarvisRequest && (selectedTool === 'image' || selectedTool === 'video')) {
        if (!clean) return;
        if (await generateMedia(clean)) setInput('');
        return;
      }
      if (!jarvisRequest && selectedTool === 'browser') {
        if (sendNativeAction('openBrowser', { command: clean })) {
          setInput('');
          setListeningText('');
          setErrorDetail(null);
          return;
        }

        const url = browserSearchUrl(clean);
        if (!url) {
          setErrorDetail('HTTP veya HTTPS ile başlayan geçerli bir web adresi ya da arama sözü yaz.');
          return;
        }
        setInput('');
        setListeningText('');
        setErrorDetail(null);
        setIsLoading(true);
        setMessages([...messages, { role: 'user', content: clean }]);
        const controller = new AbortController();
        requestControllerRef.current = controller;
        try {
          const response = await fetch('/api/browser', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'read_page', url }),
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(45_000)]),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || 'Tarayıcı isteği başarısız oldu.');
          setMessages([
            ...messages,
            { role: 'user', content: clean },
            {
              role: 'assistant',
              content: `${data.title || 'Sayfa'}\n${data.url || url}\n\n${data.content || 'Sayfada okunabilir metin bulunamadı.'}`,
            },
          ]);
        } catch (error) {
          if (controller.signal.aborted) return;
          const detail = error instanceof Error ? error.message : 'Tarayıcı isteği başarısız oldu.';
          setMessages([...messages, { role: 'user', content: clean }]);
          setErrorDetail(detail);
        } finally {
          if (requestControllerRef.current === controller) requestControllerRef.current = null;
          setIsLoading(false);
        }
        return;
      }
      if (!jarvisRequest && selectedTool && selectedTool !== 'codex') {
        const action = selectedTool === 'computer' ? 'openMacManagement' : 'openCodex';
        if (sendNativeAction(action, { command: clean || undefined })) {
          setInput('');
          setListeningText('');
          setErrorDetail(null);
          return;
        }
        setErrorDetail('Seçtiğin alan yalnızca Chloe macOS uygulamasında çalışır. Uygulamayı açıp aynı sohbetten devam et.');
        return;
      }
      const browserCommand = /^(?:browser|tarayıcı|web)\s*[:：]\s*(.+)$/iu.exec(clean)?.[1] ||
        /(?:siteyi|sayfayı|sayfayi)\s+aç\s*[:：]?\s*(https?:\/\/\S+|www\.\S+)$/iu.exec(clean)?.[1];
      if (browserCommand && sendNativeAction('openBrowser', { command: browserCommand })) {
        setInput('');
        setListeningText('');
        setErrorDetail(null);
        return;
      }
      setInput('');
      setListeningText('');
      setErrorDetail(null);
      setIsLoading(true);
      setIsResearching(needsDetailedResearch(clean));
      const controller = new AbortController();
      requestControllerRef.current = controller;
      const turnStarted = performance.now();
      let speechStream: ReturnType<typeof voice.beginSpeechStream> = null;

      let convId = activeConversationId;
      try {
        if (!convId) {
          const res = await fetch('/api/conversations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: clean.slice(0, 30) + '...' }),
            signal: controller.signal,
          });
          if (!res.ok) throw new Error(`Konuşma oluşturulamadı (${res.status}).`);
          const data = await res.json();
          convId = data.data.id;
          setActiveConversationId(convId);
          window.dispatchEvent(new Event('refreshConversations'));
        }

        const attachmentContext = attachments
          .filter((file) => file.extractedText)
          .map((file) => `\n\n[${file.name} içeriği]\n${file.extractedText}`)
          .join('');
        const newMessages: Message[] = [
          ...messages,
          { role: 'user', content: `${clean}${attachmentContext}`, attachments },
        ];
        setMessages(newMessages);
        setAttachments([]);

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: newMessages,
            settings: settingsForRequest(settings, forceJarvisMode ? { jarvisMode: true } : {}),
            conversationId: convId,
            ...(jarvisRequest ? { streamProtocol: 'jarvis-v1' } : {}),
            // Sesli tur: Jarvis'e özel API bağlantısı yalnızca bu turlarda kullanılır.
            // Yazılı sohbet ve internet işleri ana bağlantıda (varsayılan API) kalır.
            ...(voiceTurn ? { voiceTurn: true } : {}),
          }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(needsDetailedResearch(clean) ? 300_000 : 60_000)]),
        });

        if (!res.ok) {
          let errText = `Sunucu hatası (${res.status})`;
          try {
            errText = (await res.text()) || errText;
          } catch {}
          throw new Error(errText);
        }

        if (!res.body) throw new Error('Boş yanıt');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let assistantMsg = '';
        const protocol = jarvisRequest && res.headers.get('content-type')?.includes('application/x-ndjson');
        const events = new JarvisEventDecoder();
        let streamFinished = false;
        if (jarvisRequest && speakEnabled) {
          speechStream = voice.beginSpeechStream({
            onStart: () => setJarvisTiming((previous) => ({ ...previous, audioStartMs: Math.round(performance.now() - turnStarted) })),
            onEnd: () => setResumeJarvisListening(true),
            onBargeIn: () => bargeInRef.current(),
          });
        }
        const append = (text: string) => {
          assistantMsg += text;
          speechStream?.push(text);
          setMessages([...newMessages, { role: 'assistant', content: assistantMsg }]);
        };
        const receive = (event: JarvisEvent) => {
          if (event.type === 'text') append(event.text);
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'meta') setJarvisTiming((previous) => ({ ...previous, connection: event.connection }));
          if (event.type === 'routing') setJarvisTiming((previous) => ({ ...previous, servedModel: event.servedModel }));
          if (event.type === 'timing') setJarvisTiming((previous) => ({ ...previous, firstTokenMs: event.firstTokenMs ?? undefined, totalMs: event.totalMs }));
          if (event.type === 'done') streamFinished = true;
        };

        setMessages([...newMessages, { role: 'assistant', content: '' }]);

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const part = decoder.decode(value, { stream: true });
          if (protocol) events.push(part).forEach(receive);
          else append(part);
        }
        if (protocol) {
          events.push(decoder.decode(), true).forEach(receive);
          if (!streamFinished) throw new Error('Yanıt akışı tamamlanmadan kesildi. Kısmi yanıt ekranda; yeniden deneyebilirsin.');
        } else append(decoder.decode());
        if (!assistantMsg.trim()) {
          setMessages(newMessages);
          throw new Error('Model boş yanıt verdi. Model bağlantısını Ayarlar bölümünden test et.');
        }

        const modelErrorMarker = '[CHLOE_MODEL_ERROR]';
        const modelErrorIndex = assistantMsg.indexOf(modelErrorMarker);
        if (modelErrorIndex >= 0) {
          const detail = assistantMsg
            .slice(modelErrorIndex + modelErrorMarker.length)
            .trim();
          setMessages(newMessages);
          setErrorDetail(detail || 'Model yanıtı üretilemedi.');
          voice.stopSpeaking();
          if (jarvisHandsFree) setResumeJarvisListening(true);
          return;
        }

        if (speechStream) {
          speechStream.finish();
        } else if (speakEnabled && assistantMsg.trim()) {
          if (settings.jarvisMode || forceJarvisMode) {
            const tone = settings.jarvisVoiceTone;
            voice.speak(assistantMsg, {
              voiceURI: settings.jarvisVoiceURI,
              rate: tone === 'warm' ? 0.92 : tone === 'calm' ? 0.88 : 0.96,
              pitch: tone === 'warm' ? 1.03 : tone === 'calm' ? 0.98 : 1,
              onEnd: () => setResumeJarvisListening(true),
              onBargeIn: () => bargeInRef.current(),
            });
          } else {
            voice.speak(assistantMsg);
          }
        } else if ((settings.jarvisMode || forceJarvisMode) && jarvisHandsFree) {
          setResumeJarvisListening(true);
        }

        // Kimlik/uzmanlık/avatar araçlarla değişmiş olabilir → senkronla
        syncIdentity();
        refreshAvatar();
        window.dispatchEvent(new Event('refreshExpertise'));
        window.dispatchEvent(new Event('refreshConversations'));
      } catch (err: unknown) {
        if (jarvisRequest) voice.stopSpeaking();
        if (err instanceof Error && err.name === 'TimeoutError') {
          setErrorDetail('Model zaman aşımına uğradı. Ayarlar bölümünden bağlantıyı test et; detaylı araştırma dışındaki isteklerde bekleme süresi 60 saniyedir.');
          setMessages((previous) => previous.filter((message, index) => !(index === previous.length - 1 && message.role === 'assistant' && !message.content)));
          if (jarvisRequest && jarvisHandsFree) setResumeJarvisListening(true);
          return;
        }
        if (err instanceof DOMException && err.name === 'AbortError') {
          setMessages((prev) =>
            prev.filter((m, index) => !(index === prev.length - 1 && m.role === 'assistant' && !m.content))
          );
          return;
        }
        const msg = err instanceof Error ? err.message : 'Bilinmeyen hata';
        setErrorDetail(msg);
        if (jarvisRequest && jarvisHandsFree) setResumeJarvisListening(true);
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
        }
        setIsResearching(false);
        setIsLoading(false);
      }
    },
    [
      activeConversationId,
      messages,
      settings,
      attachments,
      speakEnabled,
      jarvisHandsFree,
      isLoading,
      isGenerating,
      selectedTool,
      generateMedia,
      voice,
      jarvisWork,
      refreshAvatar,
      syncIdentity,
    ]
  );

  const uploadFiles = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const form = new FormData();
      form.append('file', file);
      try {
        const response = await fetch('/api/files', { method: 'POST', body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Dosya yüklenemedi.');
        setAttachments((previous) => [...previous, data.data as Attachment]);
        if (data.data.warning) setErrorDetail(data.data.warning);
      } catch (error) {
        setErrorDetail(error instanceof Error ? error.message : 'Dosya yüklenemedi.');
      }
    }
    setShowPlusMenu(false);
  };

  const selectTool = (feature: 'browser' | 'computer' | 'codex') => {
    const opened = feature === 'codex' || Boolean(window.webkit?.messageHandlers?.chloeMac);
    setSelectedTool(feature);
    setShowPlusMenu(false);
    if (feature === 'codex') {
      setErrorDetail(null);
      return;
    }
    if (!opened && feature === 'browser') {
      setErrorDetail(null);
    } else if (!opened) {
      setErrorDetail(
        feature === 'computer'
          ? 'Bilgisayar Yönetimi yalnızca Chloe macOS uygulamasında çalışır. macOS izinleri Sistem Ayarları üzerinden onaylanmalıdır.'
          : 'Bu alan yalnızca Chloe macOS uygulamasında kullanılabilir.'
      );
    }
  };

  const selectGeneration = (type: 'image' | 'video', editId?: string) => {
    setGenerator({ type, editId });
    setSelectedTool(type);
    setShowPlusMenu(false);
    setErrorDetail(null);
    if (editId) setInput('Bu görseli düzenle: ');
  };

  const toggleGeneration = (type: 'image' | 'video') => {
    if (selectedTool === type) {
      setGenerator(null);
      setSelectedTool(null);
      setInput('');
      setErrorDetail(null);
      return;
    }
    selectGeneration(type);
  };

  const clearSelectedTool = () => {
    setSelectedTool(null);
    setGenerator(null);
  };

  const selectedToolLabel = selectedTool === 'browser' ? 'Tarayıcı Yönetimi' : selectedTool === 'computer' ? 'Bilgisayar Yönetimi' : selectedTool === 'codex' ? 'Codex' : selectedTool === 'image' ? 'Görsel üretimi' : selectedTool === 'video' ? 'Video üretimi' : '';

  const persistIdentity = useCallback(
    (s: Settings) => {
      fetch('/api/identity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assistantName: s.assistantName, userName: s.userName }),
      }).catch(() => {});
    },
    []
  );

  const toggleListening = () => {
    // Başlatma takıldıysa düğme iptal işlevi görür; ancak ilk 1,2 sn içindeki
    // ikinci dokunuş kazara sayılır — aksi hâlde mikrofon "aniden kesiliyor" gibi
    // görünür (kullanıcı düğmeye iki kez basar, ikincisi oturumu kapatır).
    if (voice.isStarting) {
      if (performance.now() - micStartAtRef.current < 1200) return;
      voice.stopListening();
      setListeningText('');
      return;
    }
    micStartAtRef.current = performance.now();
    // Ön kontrol: geçerli bir model bağlantısı yoksa mikrofonu hiç açma —
    // kullanıcı konuşup sonunda hata görmesin.
    const voiceSettings = settings.jarvisMode ? jarvisEffectiveSettings(settings) : settings;
    if (!hasExplicitConnection(settingsForRequest(voiceSettings))) {
      setErrorDetail('Önce Ayarlar bölümünden bir model bağlantısı seç.');
      return;
    }
    if (isLoading) requestControllerRef.current?.abort();
    voice.stopSpeaking();
    if (voice.isListening) {
      voice.stopListening();
      setListeningText('');
    } else {
      voice.startListening((finalText) => {
        setInput(finalText);
        sendMessage(finalText, settings.jarvisMode, true);
      });
    }
  };

  const toggleHandsFree = () => {
    const enabled = !jarvisHandsFree;
    if (enabled && !hasExplicitConnection(settingsForRequest(jarvisEffectiveSettings(settings)))) {
      setErrorDetail('Önce Jarvis Ayarları bölümünden çalışan bir model bağlantısı seç.');
      return;
    }
    setJarvisHandsFree(enabled);
    setResumeJarvisListening(false);
    if (!enabled) {
      if (voice.isListening || voice.isStarting) voice.stopListening();
      setListeningText('');
      return;
    }
    if (!isLoading && !voice.isListening && !voice.isStarting && !voice.isSpeaking && !voice.isPreparingSpeech) {
      voice.startListening((finalText) => {
        setInput(finalText);
        sendMessage(finalText, true, true);
      });
    }
  };

  const toggleJarvisVoice = () => {
    if (speakEnabled) {
      voice.stopSpeaking();
      if (jarvisHandsFree) setResumeJarvisListening(true);
    }
    setSpeakEnabled(!speakEnabled);
  };

  const toggleJarvisMode = () => {
    const enabled = !settings.jarvisMode;
    setSettings((previous) => ({ ...previous, jarvisMode: enabled }));
    if (enabled) {
      setSelectedTool(null);
      setSpeakEnabled(true);
      setJarvisHandsFree(false);
      setResumeJarvisListening(false);
      // Opening a workspace is not consent to start recording.
      voice.stopListening();
    } else {
      setResumeJarvisListening(false);
      voice.stopListening();
      voice.stopSpeaking();
      setListeningText('');
    }
  };

  // Barge-in: kullanıcı asistan konuşurken söze girerse sesi kes ve dinlemeye geç.
  useEffect(() => {
    bargeInRef.current = () => {
      voice.stopSpeaking();
      setResumeJarvisListening(false);
      startListening((finalText) => {
        setInput(finalText);
        sendMessage(finalText, true, true);
      });
    };
  }, [sendMessage, startListening, voice]);

  useEffect(() => {
    if (officeOpen || !settings.jarvisMode || !jarvisHandsFree || !resumeJarvisListening || isLoading) return;
    if (voice.isSpeaking || voice.isPreparingSpeech || voice.isListening || voice.isStarting) return;
    // Yalnızca MİKROFON kaynaklı hatalar döngüyü durdurur. Ses üretimi (TTS)
    // hatası mikrofonu engellememeli; aksi hâlde tek bir 502/422 hatası
    // hands-free döngüsünü kalıcı olarak kapatır.
    const microphoneBlocked = !sttSupported ||
      Boolean(voiceError && /mikrofon|konuşma tanıma|ses tanıma|dikte|dictation|microphone/iu.test(voiceError));
    if (microphoneBlocked) {
      const timer = window.setTimeout(() => setResumeJarvisListening(false), 0);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      setResumeJarvisListening(false);
      // Bayat TTS hatası ekranda kalırsa kullanıcıya yanlış izlenim verir.
      if (voiceError) voice.clearError();
      startListening((finalText) => {
        setInput(finalText);
        sendMessage(finalText, true, true);
      });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [
    isLoading,
    officeOpen,
    jarvisHandsFree,
    resumeJarvisListening,
    sendMessage,
    settings.jarvisMode,
    startListening,
    sttSupported,
    voiceError,
    voice.isSpeaking, voice.isPreparingSpeech, voice.isListening, voice.isStarting,
    voice.clearError,
    voice,
  ]);

  const cancelResponse = () => {
    requestControllerRef.current?.abort();
    voice.stopSpeaking();
    voice.stopListening();
    setResumeJarvisListening(false);
    setListeningText('');
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!settings.jarvisMode || officeOpen || event.repeat) return;
      if (event.key === 'Escape') { event.preventDefault(); cancelResponse(); }
      if (event.altKey && event.code === 'Space') { event.preventDefault(); toggleListening(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  const toggleTheme = () => {
    setSettings((prev) => ({
      ...prev,
      theme: prev.theme === 'dark' ? 'black' : prev.theme === 'black' ? 'light' : 'dark',
    }));
  };

  const loadConversation = async (id: string) => {
    setActiveConversationId(id);
    try {
      const res = await fetch(`/api/conversations/${id}`);
      const data = await res.json();
      if (data.success) {
        setMessages(
          (data.data.messages || []).map(
            (m: { role: 'user' | 'assistant'; content: string }) => ({
              role: m.role,
              content: m.content,
            })
          )
        );
      }
    } catch {}
  };

  const handleConversationDeleted = (id: string) => {
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
    }
  };

  const startNewChat = () => {
    setActiveConversationId(null);
    setMessages([]);
    setAttachments([]);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
    persistIdentity(settings);
  };

  const avatarSrc = avatar.file
    ? `/api/avatar?image=1&v=${avatar.version}`
    : '/chloe-portrait.jpg';

  if (!settingsReady) return (
    <main className="flex h-dvh items-center justify-center bg-white dark:bg-night-950 text-gray-600 dark:text-gray-300">
      <div role="status" className="flex items-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Kaydedilmiş AI bağlantısı yükleniyor…
      </div>
    </main>
  );

  return (
    <div className="flex h-dvh min-h-0 bg-app-bg text-app-text overflow-hidden font-sans">
      {connectionStorage.state === 'error' && <div role="alert" className="fixed top-2 left-1/2 z-[110] w-[min(94vw,640px)] -translate-x-1/2 rounded-xl border border-app-danger bg-app-surface p-3 text-sm text-app-danger">
        Bağlantı kaydı: {connectionStorage.message} <button className="underline" onClick={() => void retrySettings()}>Yeniden dene</button>
      </div>}
      {selectedTool === 'codex' && !settings.jarvisMode && <div className={officeOpen ? 'hidden' : 'flex min-w-0 flex-1'}>
        <CodeWorkspace settings={settings} onClose={clearSelectedTool} onOpenSettings={() => setIsSettingsOpen(true)} onOpenOffice={(runId, workspace) => { setOfficeContext({ runId, workspace }); setOfficeOpen(true); }}/>
      </div>}
      {officeOpen ? <AgentOffice settings={settings} initialRunId={officeContext.runId} initialWorkspace={officeContext.workspace} returnToCode={selectedTool === 'codex'} onClose={() => { setOfficeOpen(false); setSettings((previous) => ({ ...previous, jarvisMode: false })); }} onJarvis={() => { setOfficeOpen(false); if (!settings.jarvisMode) toggleJarvisMode(); }}/> : selectedTool === 'codex' && !settings.jarvisMode ? null : settings.jarvisMode ? (
        <JarvisConsole
          settings={settings}
          assistantName={settings.assistantName || 'Chloe'}
          avatarSrc={avatarSrc}
          modelName={`Sesli hızlı tur: ${modelLabel(jarvisEffectiveSettings(settings))}`}
          isListening={voice.isListening}
          isStarting={voice.isStarting}
          isSpeaking={voice.isSpeaking}
          isPreparingSpeech={voice.isPreparingSpeech}
          speechIsOnDevice={voice.speechIsOnDevice}
          isThinking={isLoading}
          speechSupported={voice.sttSupported}
          transcript={listeningText || [...messages].reverse().find((message) => message.role === 'user')?.content || ''}
          lastResponse={[...messages].reverse().find((message) => message.role === 'assistant')?.content || ''}
          error={voice.error || errorDetail}
          onExit={toggleJarvisMode}
          onToggleMic={toggleListening}
          onFinishListening={voice.finishListening}
          onCancel={cancelResponse}
          onSettingsChange={(patch) => setSettings((previous) => updateProviderSettings(previous, patch))}
          onOpenOffice={() => { cancelResponse(); setOfficeOpen(true); }}
          timing={jarvisTiming}
          workPanel={<JarvisWorkPanel
            work={jarvisWork}
            onOpenOffice={(runId, workspace) => { cancelResponse(); setOfficeContext({ runId, workspace }); setOfficeOpen(true); }}
            onReadReport={(text) => { cancelResponse(); voice.speak(text, { onEnd: () => setResumeJarvisListening(true) }); }}
          />}
          onOpenVoiceSettings={voice.openPrivacySettings}
          onToggleVoice={toggleJarvisVoice}
          voiceEnabled={speakEnabled}
          handsFree={jarvisHandsFree}
          onToggleHandsFree={toggleHandsFree}
          onSendText={(text) => sendMessage(text, true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          femaleVoices={voice.femaleVoices}
          selectedVoiceURI={settings.jarvisVoiceURI}
          voiceTone={settings.jarvisVoiceTone}
          onVoiceChange={(voiceURI) => setSettings((previous) => ({ ...previous, jarvisVoiceURI: voiceURI }))}
          onVoiceToneChange={(jarvisVoiceTone) => setSettings((previous) => ({ ...previous, jarvisVoiceTone }))}
          onPreviewVoice={() => voice.speak(`Merhaba, ben ${settings.assistantName || 'Chloe'}. Sana nasıl yardımcı olabilirim?`, {
            voiceURI: settings.jarvisVoiceURI,
            rate: settings.jarvisVoiceTone === 'warm' ? 0.92 : settings.jarvisVoiceTone === 'calm' ? 0.88 : 0.96,
            pitch: settings.jarvisVoiceTone === 'warm' ? 1.03 : settings.jarvisVoiceTone === 'calm' ? 0.98 : 1,
          })}
        />
      ) : (
        <>
      <Sidebar
        onOpenOffice={() => { cancelResponse(); setOfficeOpen(true); }}
        onNewChat={startNewChat}
        onSettingsClick={() => setIsSettingsOpen(true)}
        onSelectConversation={loadConversation}
        onConversationDeleted={handleConversationDeleted}
        activeId={activeConversationId}
        theme={settings.theme}
        onToggleTheme={toggleTheme}
      />

      <main className="flex-1 flex flex-col relative h-full page-surface">
        {/* Üst bar */}
        <div className="flex items-center justify-between gap-2 pl-18 pr-4 md:px-12 py-3 border-b border-gray-200 dark:border-night-750">
          <div className="flex min-w-0 items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span className="truncate font-medium text-gray-700 dark:text-gray-200">
              {settings.assistantName || 'Chloe'}
            </span>
            {settings.userName && <span className="truncate">· {settings.userName}</span>}
            <span className="hidden sm:inline-flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-gray-100 dark:bg-night-800 border border-gray-200 dark:border-night-700 text-[11px] text-gray-500 dark:text-gray-400">
              {modelLabel(settings)}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={toggleJarvisMode}
              aria-pressed={settings.jarvisMode}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                settings.jarvisMode
                  ? 'border-app-accent bg-app-accent/15 text-app-accent dark:text-app-accent'
                  : 'border-gray-300 text-gray-500 hover:border-app-accent hover:text-app-accent dark:border-night-700 dark:text-gray-400'
              }`}
              title={settings.jarvisMode
                ? 'JARVIS Modunu kapat'
                : settings.provider === 'cloud'
                  ? 'JARVIS Modunu aç: mikrofondan konuş, seçili API modeli yanıtlasın'
                  : 'JARVIS için önce Ayarlar bölümünden API Key modelini seç'}
            >
              <AudioLines size={15} />
              <span>JARVIS</span>
              {settings.jarvisMode && <span className="hidden sm:inline">Açık</span>}
            </button>
            <button
              onClick={() => {
                setSpeakEnabled((v) => {
                  // Ses kapatıldığında çalan yanıt da hemen susar; aksi hâlde
                  // "sesi kapat" diyen kullanıcı sesi duymaya devam eder.
                  if (v) voice.stopSpeaking();
                  return !v;
                });
              }}
              className="p-2 rounded-full text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-night-800 transition-colors"
              title={speakEnabled ? 'Sesli yanıtı kapat' : 'Sesli yanıtı aç'}
              aria-label={speakEnabled ? 'Sesli yanıtı kapat' : 'Sesli yanıtı aç'}
            >
              {speakEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>
        </div>

        {/* Sohbet alanı */}
        <div className="flex-1 overflow-y-auto px-4 md:px-12 py-8 pb-36 custom-scrollbar">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center -mt-20">
              <Avatar
                isSpeaking={voice.isSpeaking || isLoading}
                assistantName={settings.assistantName || 'Chloe'}
                src={avatarSrc}
              />
              <p className="text-gray-500 dark:text-gray-400 max-w-md text-center mt-6">
                Merhaba, ben <strong>{settings.assistantName || 'Chloe'}</strong>. Yazabilir veya 🎤 ile
                konuşabilirsin. İstersen internette araştırma yapar, bir konuda uzmanlaşırım.
              </p>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-6">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full overflow-hidden mr-3 shrink-0 border border-gray-300 dark:border-night-600">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={avatarSrc} alt="Asistan" className="w-full h-full object-cover" />
                    </div>
                  )}
                  <div
                    className={`max-w-[85%] p-4 rounded-2xl ${
                      m.role === 'user'
                        ? 'bg-app-accent text-app-on-accent rounded-br-sm border border-app-accent'
                        : 'bg-gray-100 dark:bg-transparent text-gray-800 dark:text-gray-100'
                    }`}
                  >
                    {m.attachments?.length ? (
                      <div className="mb-3 space-y-2">
                        {m.attachments.map((file) => (
                          <div key={file.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/10">
                            {file.mimeType.startsWith('image/') && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={file.dataUrl || file.url} alt={file.name} className="max-h-56 max-w-full object-contain" />
                            )}
                            {file.mimeType.startsWith('video/') && (
                              <video src={file.url} controls className="max-h-56 max-w-full" />
                            )}
                            <div className="flex items-center gap-2 px-3 py-2 text-xs opacity-80">
                              {file.mimeType.startsWith('image/') ? <ImageIcon size={14} /> : <FileText size={14} />}
                              <span className="truncate">{file.name}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  </div>
                </div>
              ))}
              <div ref={endOfMessagesRef} />
            </div>
          )}
        </div>

        {/* Girdi alanı */}
        <div className="absolute bottom-0 left-0 w-full bg-gradient-to-t from-white via-white dark:from-night-950 dark:via-night-950 to-transparent p-4 md:px-12 pb-6">
          <div className="max-w-4xl mx-auto">
            {selectedTool && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-app-accent/30 bg-app-accent/10 px-3 py-2 text-xs text-app-accent dark:text-app-accent">
                <span className="font-semibold">Aktif alan: {selectedToolLabel}</span>
                <span className="text-app-accent/70 dark:text-app-accent/70">Sonraki mesaj bu alana gönderilecek.</span>
                <button type="button" onClick={clearSelectedTool} className="ml-auto rounded-md px-2 py-0.5 text-app-accent hover:bg-app-accent/20 dark:text-app-accent" title="Aktif alanı kaldır">Kaldır</button>
              </div>
            )}
            {voice.error && (
              <div className="mb-2 text-sm text-red-500 text-center">{voice.error}</div>
            )}
            {errorDetail && (
              <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                <div className="font-medium">Yanıt alınamadı</div>
                <div className="mt-1 whitespace-pre-wrap break-words text-xs text-red-200/90">
                  {errorDetail}
                </div>
              </div>
            )}
            {isResearching && (
              <div className="mb-2 flex items-center justify-center gap-2 text-xs text-app-accent">
                <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-app-accent" />
                Detaylı araştırma yapılıyor; kaynaklar okunuyor ve bilgi bankasına ekleniyor…
              </div>
            )}
            {attachments.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {attachments.map((file) => (
                  <div key={file.id} className="group flex max-w-[240px] items-center gap-2 rounded-xl border border-gray-300 bg-gray-50 px-2 py-1.5 text-xs dark:border-night-700 dark:bg-night-800">
                    {file.mimeType.startsWith('image/') ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.dataUrl || file.url} alt="" className="h-8 w-8 rounded-md object-cover" />
                    ) : file.mimeType.startsWith('video/') ? (
                      <video src={file.url} controls className="h-10 w-16 shrink-0 rounded-md bg-black" aria-label={file.name} />
                    ) : <FileText size={18} className="text-app-accent" />}
                    <span className="truncate text-gray-700 dark:text-gray-200">{file.name}</span>
                    {file.mimeType.startsWith('image/') && (
                      <button
                        type="button"
                        onClick={() => selectGeneration('image', file.id)}
                        className="rounded-md p-1 text-app-accent hover:bg-app-accent/10"
                        title="Görseli düzenle"
                      >
                        <Sparkles size={14} />
                      </button>
                    )}
                    <button type="button" onClick={() => setAttachments((previous) => previous.filter((item) => item.id !== file.id))} className="rounded-md p-1 text-gray-400 hover:text-red-500" title="Kaldır">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(input);
              }}
              className="relative flex flex-wrap sm:flex-nowrap items-end gap-2 bg-gray-100 dark:bg-night-800 rounded-3xl border border-gray-300 dark:border-night-700 shadow-xl focus-within:ring-1 focus-within:ring-app-accent/50 p-2 pl-4 transition-all"
              >
              <textarea
                value={listeningText || input}
                disabled={isLoading || isGenerating}
                onChange={(e) => {
                  setInput(e.target.value);
                  setListeningText('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage(input);
                  }
                }}
                placeholder={
                  isLoading
                    ? 'Yanıt bekleniyor... İstersen sağdaki düğmeyle iptal edebilirsin.'
                    : selectedTool === 'image'
                      ? 'Üretilecek görseli tarif et…'
                      : selectedTool === 'video'
                        ? 'Üretilecek videoyu tarif et…'
                    : voice.isListening
                      ? 'Dinliyorum...'
                      : `${settings.assistantName || 'Chloe'}'e mesaj gönder...`
                }
                className="min-w-0 basis-full sm:basis-auto flex-1 max-h-48 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none resize-none py-3 custom-scrollbar disabled:cursor-not-allowed disabled:opacity-60"
                rows={1}
                style={{ minHeight: '44px' }}
              />

              <div className="flex gap-1 pb-1 pr-1 shrink-0 ml-auto">
                <button
                  type="button"
                  onClick={() => toggleGeneration('image')}
                  disabled={isLoading || isGenerating}
                  aria-pressed={selectedTool === 'image'}
                  className={`relative flex items-center gap-1 rounded-full px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                    selectedTool === 'image'
                      ? 'bg-purple-600 text-white shadow-sm ring-2 ring-purple-300 dark:bg-purple-500 dark:ring-purple-400/40'
                      : 'text-purple-600 hover:bg-purple-500/10 dark:text-purple-300 dark:hover:bg-purple-500/15'
                  }`}
                  title={selectedTool === 'image' ? 'Görsel üretimini kapat' : 'Görsel üretimini seç'}
                >
                  <ImageIcon size={17} />
                  <span className="hidden sm:inline">Görsel</span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleGeneration('video')}
                  disabled={isLoading || isGenerating}
                  aria-pressed={selectedTool === 'video'}
                  className={`relative flex items-center gap-1 rounded-full px-2.5 py-2 text-xs font-medium transition-colors disabled:opacity-40 ${
                    selectedTool === 'video'
                      ? 'bg-pink-600 text-white shadow-sm ring-2 ring-pink-300 dark:bg-pink-500 dark:ring-pink-400/40'
                      : 'text-pink-600 hover:bg-pink-500/10 dark:text-pink-300 dark:hover:bg-pink-500/15'
                  }`}
                  title={selectedTool === 'video' ? 'Video üretimini kapat' : 'Video üretimini seç'}
                >
                  <Video size={17} />
                  <span className="hidden sm:inline">Video</span>
                </button>
                <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowPlusMenu((value) => !value)}
                  disabled={isLoading || isGenerating}
                    className="p-3 rounded-full text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-night-700 transition-colors disabled:opacity-40"
                    title="Dosya ve üretim seçenekleri"
                    aria-label="Dosya ve üretim seçenekleri"
                  >
                    <Plus size={20} className={showPlusMenu ? 'rotate-45 transition-transform' : 'transition-transform'} />
                  </button>
                  {showPlusMenu && (
                    <div className="absolute bottom-14 right-0 z-20 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-2xl dark:border-night-700 dark:bg-night-850">
                      <button type="button" onClick={() => fileInputRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-night-750">
                        <Upload size={17} className="text-app-accent" /> Dosya / fotoğraf yükle
                      </button>
                      <div className="mb-1 border-b border-gray-200 px-3 pb-2 text-[11px] text-gray-500 dark:border-night-700 dark:text-gray-400">Diğer araçlar</div>
                      <button type="button" onClick={() => { setShowPlusMenu(false); cancelResponse(); setOfficeOpen(true); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-night-750"><Users size={17} className="text-emerald-400"/> Ajan Ofisi</button>
                      <button type="button" onClick={() => selectTool('browser')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-night-750 ${selectedTool === 'browser' ? 'bg-app-accent/10 text-app-accent dark:text-app-accent' : ''}`}>
                        <Globe size={17} className="text-blue-500" /> Tarayıcı Yönetimi
                      </button>
                      {/* Computer management needs the macOS app's native bridge; elsewhere it could only fail. */}
                      {nativeMac && (
                        <button type="button" onClick={() => selectTool('computer')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-night-750 ${selectedTool === 'computer' ? 'bg-app-accent/10 text-app-accent dark:text-app-accent' : ''}`}>
                          <Monitor size={17} className="text-orange-500" /> Bilgisayar Yönetimi
                        </button>
                      )}
                      <button type="button" onClick={() => selectTool('codex')} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-night-750 ${selectedTool === 'codex' ? 'bg-app-accent/10 text-app-accent dark:text-app-accent' : ''}`}>
                        <Code2 size={17} className="text-emerald-500" /> Codex
                      </button>
                    </div>
                  )}
                  <input ref={fileInputRef} type="file" hidden multiple accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { if (event.target.files) void uploadFiles(event.target.files); event.target.value = ''; }} />
                </div>
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={isLoading || isGenerating}
                  className={`p-3 rounded-full transition-colors flex items-center justify-center ${
                    voice.isListening
                      ? 'bg-red-500 text-white'
                      : 'text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white hover:bg-gray-200 dark:hover:bg-night-700'
                  }`}
                  title="Sesli Konuş"
                >
                  {voice.isListening ? <MicOff size={20} /> : <Mic size={20} />}
                </button>
                {isLoading || isGenerating ? (
                  <button
                    type="button"
                    onClick={cancelResponse}
                    className="p-3 bg-red-500 text-white hover:bg-red-400 rounded-full transition-colors flex items-center justify-center"
                    title="Yanıtı iptal et"
                    aria-label="Yanıtı iptal et"
                  >
                    <Square size={18} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="p-3 bg-app-accent text-app-on-accent hover:opacity-90 rounded-full transition-colors flex items-center justify-center disabled:opacity-50 disabled:bg-gray-400 dark:disabled:bg-night-700 disabled:text-gray-200 dark:disabled:text-gray-400"
                  disabled={isGenerating || !(input.trim() || listeningText.trim())}
                >
                    {isGenerating ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>

      </main>
        </>
      )}

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={closeSettings}
        settings={settings}
        onChange={setSettings}
        storage={connectionStorage}
      />
    </div>
  );
}
