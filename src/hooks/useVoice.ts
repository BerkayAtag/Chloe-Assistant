'use client';
/* Web Speech API tarayıcı tarafında tam tiplenmediği için bu dosyada any'ye izin verilir. */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useRef, useState } from 'react';
import { settingsForRequest, type Settings } from '@/lib/settings';
import { cleanSpeechText, createSpeechTextBuffer, splitSpeechText, jarvisDictationClean } from '@/lib/speech-text';
import { createSpeechQueue } from '@/lib/speech-queue';
import { createBargeInDetector, rmsLevel } from '@/lib/barge-in';
import { playAudioCue } from '@/lib/audio-cues';
import { playPcmResponse } from '@/lib/pcm-player';

export type SpeechOptions = { rate?: number; pitch?: number; voiceURI?: string; onEnd?: () => void; onStart?: () => void;
  /** Kullanıcı konuşmaya başladığında (barge-in) çağrılır. */ onBargeIn?: () => void };

interface UseVoiceOptions {
  lang?: string;
  onPartial?: (text: string) => void;
  settings?: Settings;
}

export type FemaleSpeechVoice = {
  voiceURI: string;
  name: string;
  lang: string;
};

const FEMALE_VOICE_NAME = /\b(female|woman|girl|kadın|samantha|ava|allison|susan|zoe|victoria|karen|moira|tessa|fiona|veena|zira|jenny|aria|sonia|hazel|eva|heera|sara|katja|helena|yelda|filiz|seda|zeynep|selin|ece|defne|emel|aylin|meltem|burcu|gül|gul|elif|dilara|esra|nil|özge|ozge|ipek|ipek|şebnem|sebnem|leyla|leila|yasemin|merve|ayşe|ayse|gizem|bahar|damla|derya|melisa|nehir|tuğçe|tugce)\b/iu;

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
  onresult: ((e: any) => void) | null;
  start: () => void;
  stop: () => void;
};

/**
 * Web Speech API tabanlı sesli iletişim (STT + TTS) hook'u.
 * Mikrofon iznini yönetir, konuşmayı metne çevirir ve yanıtları sesli okur.
 */
export function useVoice({ lang = 'tr-TR', onPartial, settings }: UseVoiceOptions = {}) {
  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPreparingSpeech, setIsPreparingSpeech] = useState(false);
  const [speechIsOnDevice, setSpeechIsOnDevice] = useState<boolean | null>(null);
  const [sttSupported] = useState(
    () =>
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window ||
        'webkitSpeechRecognition' in window ||
        Boolean((window as any).webkit?.messageHandlers?.chloeMac))
  );
  const [ttsSupported] = useState(
    () => typeof window !== 'undefined' && ('speechSynthesis' in window || Boolean((window as any).webkit?.messageHandlers?.chloeMac))
  );
  const [error, setError] = useState<string | null>(null);
  const [femaleVoices, setFemaleVoices] = useState<FemaleSpeechVoice[]>([]);

  const recognitionRef = useRef<RecognitionLike | null>(null);
  const recognitionWatchdogRef = useRef<number | null>(null);
  const recognitionStartTimerRef = useRef<number | null>(null);
  const turnTimerRef = useRef<number | null>(null);
  const finishTurnRef = useRef<(() => void) | null>(null);
  const clearTurnTimer = useCallback(() => {
    if (turnTimerRef.current !== null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = null;
  }, []);
  const nativeSpeechActiveRef = useRef(false);
  const sttCallbackRef = useRef<(text: string) => void>(() => {});
  const finalCallbackRef = useRef<((text: string) => void) | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voiceRequestRef = useRef<{ id: string; onEnd?: () => void } | null>(null);
  const voiceSequenceRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const audioControllerRef = useRef<AbortController | null>(null);
  const nativeDictationStartTimerRef = useRef<number | null>(null);
  const nativeSpeechStartTimerRef = useRef<number | null>(null);
  const clearRecognitionStartTimer = useCallback(() => {
    if (recognitionStartTimerRef.current !== null) {
      window.clearTimeout(recognitionStartTimerRef.current);
      recognitionStartTimerRef.current = null;
    }
  }, []);
  const clearNativeDictationStartTimer = useCallback(() => {
    if (nativeDictationStartTimerRef.current !== null) {
      window.clearTimeout(nativeDictationStartTimerRef.current);
      nativeDictationStartTimerRef.current = null;
    }
  }, []);
  const clearNativeSpeechStartTimer = useCallback(() => {
    if (nativeSpeechStartTimerRef.current !== null) {
      window.clearTimeout(nativeSpeechStartTimerRef.current);
      nativeSpeechStartTimerRef.current = null;
    }
  }, []);
  /**
   * Dinleme sırasında tarayıcı hiçbir olay göndermeden oturumu düşürürse
   * (Chrome'da bilinen bir durum) mikrofon düğmesi kalıcı olarak ölü kalır.
   * Bu bekçi, sonuç gelmeyen oturumu kapatıp durumu sıfırlar.
   */
  const clearRecognitionWatchdog = useCallback(() => {
    if (recognitionWatchdogRef.current !== null) {
      window.clearTimeout(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = null;
    }
  }, []);
  /** Her konuşma etkinliğinde bekçiyi yeniden kurar: uzun ama canlı oturumlar kapanmaz. */
  const touchRecognitionWatchdog = useCallback((rec: RecognitionLike) => {
    if (recognitionRef.current !== rec) return;
    clearRecognitionWatchdog();
    recognitionWatchdogRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      recognitionWatchdogRef.current = null;
      try { rec.stop(); } catch { /* Zaten durmuş olabilir. */ }
      setIsStarting(false);
      setIsListening(false);
      setError('Mikrofon oturumu sessiz kaldı ve kapatıldı. Düğmeye basıp yeniden dene.');
    }, 60000);
  }, [clearRecognitionWatchdog]);
  const armRecognitionWatchdog = useCallback((rec: RecognitionLike) => {
    clearRecognitionWatchdog();
    recognitionWatchdogRef.current = window.setTimeout(() => {
      if (recognitionRef.current !== rec) return;
      recognitionRef.current = null;
      recognitionWatchdogRef.current = null;
      try { rec.stop(); } catch { /* Zaten durmuş olabilir. */ }
      setIsStarting(false);
      setIsListening(false);
      setError('Mikrofon oturumu yanıt vermedi ve kapatıldı. Düğmeye basıp yeniden dene.');
    }, 45000);
  }, [clearRecognitionWatchdog]);
  /** Mikrofon aç/kapa sinyali (ayarla kapatılabilir). Kullanıcı mikronun ne zaman
   *  açık olduğunu duyar; "aniden kesildi" belirsizliğini önler. */
  const cue = useCallback((kind: 'mic-open' | 'mic-close' | 'blocked') => {
    if (settings?.jarvisAudioCues === false) return;
    playAudioCue(kind);
  }, [settings?.jarvisAudioCues]);
  const clearAudio = useCallback(() => {
    audioControllerRef.current?.abort(); audioControllerRef.current = null;
    if (audioRef.current) { audioRef.current.onended = null; audioRef.current.onerror = null; audioRef.current.pause(); audioRef.current.src = ''; audioRef.current = null; }
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }, []);
  const bargeMonitorRef = useRef<{ stop: () => void } | null>(null);
  const stopBargeInMonitor = useCallback(() => {
    bargeMonitorRef.current?.stop();
    bargeMonitorRef.current = null;
  }, []);
  /**
   * Barge-in: asistan konuşurken mikrofon enerjisini izler; kullanıcı söze
   * girerse bildirir. Varsayılan kapalıdır (jarvisBargeIn) ve mikrofon izni
   * yoksa sessizce devre dışı kalır — mevcut akışı bozmaz.
   */
  const startBargeInMonitor = useCallback((onInterrupt: () => void) => {
    stopBargeInMonitor();
    const media = typeof navigator === 'undefined' ? null : navigator.mediaDevices;
    if (!media?.getUserMedia) return;
    let cancelled = false;
    const resources: { stream?: MediaStream; context?: AudioContext; frame?: number } = {};
    const detector = createBargeInDetector();
    void media.getUserMedia({ audio: true }).then((stream) => {
      if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return; }
      resources.stream = stream;
      const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) { stream.getTracks().forEach((track) => track.stop()); return; }
      const context: AudioContext = new Ctor();
      resources.context = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (cancelled) return;
        analyser.getFloatTimeDomainData(samples);
        if (detector.push(rmsLevel(samples))) { onInterrupt(); return; }
        resources.frame = requestAnimationFrame(tick);
      };
      resources.frame = requestAnimationFrame(tick);
    }).catch(() => { /* mikrofon izni yoksa barge-in sessizce kapalı kalır */ });
    bargeMonitorRef.current = {
      stop() {
        cancelled = true;
        if (resources.frame !== undefined) cancelAnimationFrame(resources.frame);
        resources.stream?.getTracks().forEach((track) => track.stop());
        void resources.context?.close().catch(() => {});
      },
    };
  }, [stopBargeInMonitor]);
  useEffect(() => () => {
    clearAudio();
    clearTurnTimer();
    stopBargeInMonitor();
    clearRecognitionWatchdog();
    // Sayfadan çıkılırken cihaz sesi de susmalı; aksi hâlde konuşma arka planda sürer.
    try { (window as any).webkit?.messageHandlers?.chloeMac?.postMessage({ action: 'stopSpeaking' }); } catch { /* köprü yoksa yok say */ }
    try { window.speechSynthesis?.cancel(); } catch { /* tarayıcı desteklemiyorsa yok say */ }
    try { recognitionRef.current?.stop(); } catch { /* Already stopped by the browser. */ }
  }, [clearAudio, clearTurnTimer, clearRecognitionWatchdog, stopBargeInMonitor]);

  useEffect(() => {
    const handler = (window as any).webkit?.messageHandlers?.chloeMac;
    if (!handler) return;
    const onVoice = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; voices?: FemaleSpeechVoice[]; started?: boolean; finished?: boolean; stopped?: boolean; error?: string }>).detail;
      if (Array.isArray(detail?.voices)) setFemaleVoices(detail.voices);
      if (!detail?.id || detail.id !== voiceRequestRef.current?.id) return;
      if (detail.started) {
        clearNativeSpeechStartTimer();
        setIsPreparingSpeech(false);
        setIsSpeaking(true);
      }
      if (detail.error || detail.finished || detail.stopped) {
        clearNativeSpeechStartTimer();
        setIsPreparingSpeech(false);
        setIsSpeaking(false);
        const callback = voiceRequestRef.current.onEnd;
        voiceRequestRef.current = null;
        if (detail.error) setError(detail.error);
        if (detail.error || detail.finished) callback?.();
      }
    };
    window.addEventListener('chloeNativeVoice', onVoice);
    handler.postMessage({ action: 'getSpeechVoices' });
    return () => {
      voiceRequestRef.current = null;
      handler.postMessage({ action: 'stopSpeaking' });
      window.removeEventListener('chloeNativeVoice', onVoice);
    };
  }, [clearNativeSpeechStartTimer]);

  // STT callback'ini güncel tut
  useEffect(() => {
    sttCallbackRef.current = onPartial || (() => {});
  }, [onPartial]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onNativeSpeech = (event: Event) => {
      const detail = (event as CustomEvent<{
        text?: string;
        final?: boolean;
        error?: string;
        starting?: boolean;
        started?: boolean;
        stopped?: boolean;
        onDevice?: boolean;
      }>).detail;
      if (detail?.error) {
        clearNativeDictationStartTimer();
        cue('blocked');
        setError(detail.error);
        setIsStarting(false);
        setIsListening(false);
        setSpeechIsOnDevice(null);
        nativeSpeechActiveRef.current = false;
        finalCallbackRef.current = null;
        return;
      }
      if (detail?.starting) {
        setIsStarting(true);
        setIsListening(false);
        setSpeechIsOnDevice(null);
        nativeSpeechActiveRef.current = true;
      }
      if (detail?.started) {
        clearNativeDictationStartTimer();
        cue('mic-open');
        setIsStarting(false);
        setIsListening(true);
        setSpeechIsOnDevice(typeof detail.onDevice === 'boolean' ? detail.onDevice : null);
        setError(null);
        nativeSpeechActiveRef.current = true;
      }
      if (detail?.stopped) {
        clearNativeDictationStartTimer();
        cue('mic-close');
        setIsStarting(false);
        setIsListening(false);
        setSpeechIsOnDevice(null);
        nativeSpeechActiveRef.current = false;
        finalCallbackRef.current = null;
      }
      if (!detail?.text || !nativeSpeechActiveRef.current) return;
      sttCallbackRef.current(detail.text);
      if (detail.final) {
        clearNativeDictationStartTimer();
        finalCallbackRef.current?.(detail.text.trim());
        finalCallbackRef.current = null;
        setIsStarting(false);
        setIsListening(false);
        nativeSpeechActiveRef.current = false;
      }
    };
    window.addEventListener('chloeNativeSpeechResult', onNativeSpeech);
    return () => window.removeEventListener('chloeNativeSpeechResult', onNativeSpeech);
  }, [clearNativeDictationStartTimer, cue]);

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if ((window as any).webkit?.messageHandlers?.chloeMac) return;
    const updateVoices = () => {
      setFemaleVoices(
        window.speechSynthesis.getVoices()
          .filter((voice) => voice.lang.toLowerCase().startsWith('tr') && FEMALE_VOICE_NAME.test(voice.name))
          .map(({ voiceURI, name, lang }) => ({ voiceURI, name, lang }))
          .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
      );
    };
    updateVoices();
    window.speechSynthesis.addEventListener('voiceschanged', updateVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', updateVoices);
  }, []);

  const startListening = useCallback(
    (onFinal: (text: string) => void) => {
      if (typeof window === 'undefined') return;
      const nativeSpeech = (window as any).webkit?.messageHandlers?.chloeMac;
      if (nativeSpeech) {
        if (nativeSpeechActiveRef.current) return;
        nativeSpeechActiveRef.current = true;
        finalCallbackRef.current = onFinal;
        setIsStarting(true);
        setIsListening(false);
        setSpeechIsOnDevice(null);
        setError(null);
        nativeDictationStartTimerRef.current = window.setTimeout(() => {
          if (!nativeSpeechActiveRef.current) return;
          nativeSpeechActiveRef.current = false;
          nativeDictationStartTimerRef.current = null;
          finalCallbackRef.current = null;
          setIsStarting(false);
          setIsListening(false);
          setError('macOS konuşma tanıma başlatılamadı. Mikrofon iznini ve seçili dili kontrol et.');
        }, 45000);
        try {
          // Sessizlik eşiği: cümle ortasındaki doğal duraklamada mikrofon kapanmasın.
          // Jarvis hızlı modda 1,9 sn; normal modda 2,4 sn.
          const fastDictation = settings?.jarvisMode && settings.jarvisFastMode !== false;
          const silenceMs = settings?.jarvisSilenceMs ?? (fastDictation ? 1900 : 2400);
          nativeSpeech.postMessage({ action: 'startDictation', command: fastDictation ? 'fast' : 'normal', silenceMs, autoSend: settings?.jarvisAutoSend !== false });
        } catch (cause: unknown) {
          clearNativeDictationStartTimer();
          nativeSpeechActiveRef.current = false;
          finalCallbackRef.current = null;
          setIsStarting(false);
          setError(cause instanceof Error ? cause.message : 'macOS sesli dikte başlatılamadı.');
        }
        return;
      }
      // Devam eden bir tanıma oturumu varsa yenisini başlatma: aksi hâlde
      // aktif mikrofon sahipsiz kalır ve sonuç ilk çağırana ulaşmaz.
      if (recognitionRef.current) return;
      const SR =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SR) {
        setIsStarting(false);
        setError('Bu tarayıcı konuşma tanımayı desteklemiyor.');
        return;
      }

      let rec: RecognitionLike;
      try {
        rec = new SR();
      } catch (cause: unknown) {
        setIsStarting(false);
        setError(cause instanceof Error ? `Ses tanıma başlatılamadı: ${cause.message}` : 'Ses tanıma başlatılamadı.');
        return;
      }
      recognitionRef.current = rec;
      let delivered = false;
      let latestText = '', committedText = '', restarts = 0;
      const jarvis = settings?.jarvisMode === true;
      const autoSend = settings?.jarvisAutoSend !== false;
      const silenceMs = settings?.jarvisSilenceMs ?? 2500;
      const finish = () => {
        if (recognitionRef.current !== rec || delivered) return;
        const text = [committedText, latestText].filter(Boolean).join(' ').trim();
        if (!text) return;
        delivered = true;
        clearTurnTimer(); clearRecognitionWatchdog(); clearRecognitionStartTimer();
        recognitionRef.current = null; finishTurnRef.current = null;
        setIsStarting(false); setIsListening(false); cue('mic-close');
        try { rec.stop(); } catch { /* Already stopped by recognition service. */ }
        onFinal(text);
      };
      finishTurnRef.current = finish;
      rec.lang = lang;
      rec.continuous = jarvis;
      rec.interimResults = true;

      rec.onstart = () => {
        if (recognitionRef.current !== rec) return;
        clearRecognitionStartTimer();
        cue('mic-open');
        armRecognitionWatchdog(rec);
        setIsStarting(false);
        setIsListening(true);
        setSpeechIsOnDevice(null);
        setError(null);
      };

      rec.onresult = (event: any) => {
        if (recognitionRef.current !== rec || delivered) return;
        let finalText = '';
        let interimText = '';
        for (let i = jarvis ? 0 : event.resultIndex; i < event.results.length; i++) {
          const r = event.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interimText += r[0].transcript;
        }
        if (interimText || finalText) touchRecognitionWatchdog(rec);
        if (jarvis) {
          latestText = [finalText, interimText].filter(Boolean).join(' ').trim();
          sttCallbackRef.current([committedText, latestText].filter(Boolean).join(' '));
          clearTurnTimer();
          if (autoSend && latestText) turnTimerRef.current = window.setTimeout(finish, silenceMs);
          return;
        }
        if (interimText) sttCallbackRef.current(interimText);
        if (finalText.trim()) {
          delivered = true;
          clearRecognitionWatchdog();
          rec.stop();
          onFinal(finalText.trim());
        }
      };

      rec.onerror = (e: any) => {
        if (recognitionRef.current !== rec) return;
        clearRecognitionStartTimer();
        clearRecognitionWatchdog();
        clearTurnTimer(); finishTurnRef.current = null;
        // Bazı tarayıcılar onerror'dan sonra onend göndermez; referansı burada
        // bırakmak mikrofon düğmesini kalıcı olarak sessiz/ölü hâle getirir.
        recognitionRef.current = null;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          cue('blocked');
          setError('Mikrofon izni reddedildi. Tarayıcı ayarlarından izin verin.');
        } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
          setError(`Ses hatası: ${e.error}`);
        }
        setIsStarting(false);
        setIsListening(false);
      };

      rec.onend = () => {
        if (recognitionRef.current !== rec) return;
        // A recognition segment ending is not the user's turn ending.
        if (jarvis && !delivered && restarts < 3) {
          committedText = [committedText, latestText].filter(Boolean).join(' ').trim();
          latestText = ''; restarts++;
          try { rec.start(); return; } catch { /* Surface a recoverable stop below. */ }
        }
        if (jarvis && !delivered) setError('Ses tanıma oturumu sona erdi. Metin ekranda korundu; yeniden mikrofonu açabilirsin.');
        clearTurnTimer(); finishTurnRef.current = null;
        clearRecognitionStartTimer();
        clearRecognitionWatchdog();
        cue('mic-close');
        setIsStarting(false);
        setIsListening(false);
        if (recognitionRef.current === rec) recognitionRef.current = null;
      };

      try {
        setIsStarting(true);
        recognitionStartTimerRef.current = window.setTimeout(() => {
          if (recognitionRef.current !== rec) return;
          recognitionRef.current = null;
          recognitionStartTimerRef.current = null;
          try { rec.stop(); } catch { /* The recognizer may not have started. */ }
          setIsStarting(false);
          setIsListening(false);
          setError('Tarayıcı mikrofonu başlatamadı. Mikrofon iznini ve ses giriş aygıtını kontrol et.');
        }, 15000);
        rec.start();
      } catch (cause: unknown) {
        clearRecognitionStartTimer();
        recognitionRef.current = null;
        setIsStarting(false);
        setIsListening(false);
        setError(cause instanceof Error ? `Mikrofon başlatılamadı: ${cause.message}` : 'Mikrofon başlatılamadı.');
      }
    },
    [lang, settings?.jarvisMode, settings?.jarvisFastMode, settings?.jarvisSilenceMs, settings?.jarvisAutoSend, cue, clearTurnTimer, armRecognitionWatchdog, touchRecognitionWatchdog, clearNativeDictationStartTimer, clearRecognitionStartTimer, clearRecognitionWatchdog]
  );

  const stopListening = useCallback(() => {
    clearTurnTimer(); finishTurnRef.current = null;
    clearRecognitionStartTimer();
    clearRecognitionWatchdog();
    clearNativeDictationStartTimer();
    const nativeSpeech = typeof window !== 'undefined'
      ? (window as any).webkit?.messageHandlers?.chloeMac
      : null;
    try {
      nativeSpeech?.postMessage({ action: 'stopDictation' });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Mikrofon durdurulamadı.');
    }
    const recognition = recognitionRef.current;
    // Invalidate first: browsers may deliver a final result after stop().
    recognitionRef.current = null;
    nativeSpeechActiveRef.current = false;
    try { recognition?.stop(); } catch { /* Already stopped. */ }
    finalCallbackRef.current = null;
    setIsStarting(false);
    setIsListening(false);
    sttCallbackRef.current('');
  }, [clearNativeDictationStartTimer, clearRecognitionStartTimer, clearRecognitionWatchdog, clearTurnTimer]);

  const finishListening = useCallback(() => {
    if (nativeSpeechActiveRef.current) {
      (window as any).webkit?.messageHandlers?.chloeMac?.postMessage({ action: 'finishDictation' });
    } else finishTurnRef.current?.();
  }, []);

  const openPrivacySettings = useCallback((kind: 'speech' | 'microphone') => {
    const nativeSpeech = typeof window !== 'undefined'
      ? (window as any).webkit?.messageHandlers?.chloeMac
      : null;
    if (!nativeSpeech) {
      setError(kind === 'microphone'
        ? 'Tarayıcının adres çubuğundaki site ayarlarından mikrofon izni ver.'
        : 'macOS Sistem Ayarları > Gizlilik ve Güvenlik > Konuşma Tanıma bölümünden izin ver.');
      return;
    }
    try {
      nativeSpeech.postMessage({
        action: kind === 'microphone' ? 'openMicrophoneSettings' : 'openSpeechSettings',
      });
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Gizlilik ayarları açılamadı.');
    }
  }, []);

  const startCloudSpeech = useCallback((opts?: SpeechOptions) => {
    if (!settings) return null;
    stopListening();
    clearAudio();
    voiceRequestRef.current = null;
    utteranceRef.current = null;
    const native = (window as any).webkit?.messageHandlers?.chloeMac;
    native?.postMessage({ action: 'stopSpeaking' });
    window.speechSynthesis?.cancel();
    setError(null); setIsSpeaking(false);
    const controller = new AbortController();
    audioControllerRef.current = controller;
    let started = false;
    const current = () => audioControllerRef.current === controller && !controller.signal.aborted;
    return createSpeechQueue<{ blob: Blob } | { stream: Response }>({
      signal: controller.signal,
      preparing: () => { if (current()) setIsPreparingSpeech(true); },
      prepare: async (text) => {
        const cleanedText = jarvisDictationClean(text);
        const response = await fetch('/api/voice', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          // Sunucu yanıt vermezse istek sonsuza kadar asılı kalmasın; aksi hâlde
          // "Ses hazırlanıyor" durumu kalıcı olur ve hands-free döngüsü durur.
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(60000)]),
          body: JSON.stringify({ text: cleanedText, voice: settings.jarvisCloudVoice, tone: settings.jarvisVoiceTone, settings: settingsForRequest(settings),
            ...(typeof window.AudioContext === 'function' ? { stream: 'pcm-v1' } : {}) }),
        });
        if (!response.ok) {
          const data = await response.json();
          throw Object.assign(new Error(data.error || 'Ses üretilemedi.'), { statusCode: response.status });
        }
        return response.headers?.get('content-type')?.startsWith('audio/x-chloe-pcm')
          ? { stream: response } : { blob: await response.blob() };
      },
      shouldRetry: (error) => {
        const status = (error as { statusCode?: number } | null)?.statusCode;
        return !status || status < 400 || status >= 500;
      },
      play: async (clip) => {
        if ('stream' in clip) {
          try {
            await playPcmResponse(clip.stream, controller.signal, () => {
              if (!current()) return;
              setIsPreparingSpeech(false); setIsSpeaking(true);
              if (!started) { started = true; opts?.onStart?.(); }
              if (settings.jarvisBargeIn && opts?.onBargeIn) startBargeInMonitor(opts.onBargeIn);
            });
          } finally { stopBargeInMonitor(); if (current()) setIsSpeaking(false); }
          return;
        }
        return new Promise<void>((resolve, reject) => {
        if (!current()) { resolve(); return; }
        const url = URL.createObjectURL(clip.blob);
        const audio = new Audio(url);
        audioRef.current = audio; audioUrlRef.current = url;
        const cleanup = () => {
          audio.onended = null; audio.onerror = null; audio.pause(); audio.src = '';
          controller.signal.removeEventListener('abort', cancelled);
          stopBargeInMonitor();
          URL.revokeObjectURL(url);
          if (audioRef.current === audio) audioRef.current = null;
          if (audioUrlRef.current === url) audioUrlRef.current = null;
        };
        const cancelled = () => { cleanup(); resolve(); };
        controller.signal.addEventListener('abort', cancelled, { once: true });
        audio.onended = () => { cleanup(); if (current()) setIsSpeaking(false); resolve(); };
        audio.onerror = () => { cleanup(); reject(new Error('Üretilen ses oynatılamadı. Sesi dene düğmesine dokunarak tekrar dene.')); };
        void audio.play().then(() => {
          if (current() && audioRef.current === audio) {
            setIsPreparingSpeech(false); setIsSpeaking(true);
            if (!started) { started = true; opts?.onStart?.(); }
            // Konuşma başladı: kullanıcı söze girerse sesi kes (varsayılan kapalı).
            if (settings?.jarvisBargeIn && opts?.onBargeIn) startBargeInMonitor(opts.onBargeIn);
          }
        }, (error) => { cleanup(); reject(error); });
        });
      },
      ended: () => { if (current()) { clearAudio(); setIsSpeaking(false); setIsPreparingSpeech(false); opts?.onEnd?.(); } },
      failed: (error) => {
        if (!current()) return;
        clearAudio(); setIsSpeaking(false); setIsPreparingSpeech(false);
        setError(error instanceof Error ? error.message : 'Ses üretilemedi.');
        // Ses üretilemese bile tur biter: onEnd çağrılmazsa hands-free döngüsü
        // bir daha mikrofonu açmaz ve kullanıcı elle müdahale etmek zorunda kalır.
        opts?.onEnd?.();
      },
      skipped: (error, moreRemaining) => {
        // Tek bölüm okunamadı; okunacak başka bölüm varsa bunu açıkça söyle.
        if (!current()) return;
        const reason = error instanceof Error ? error.message : 'Bir bölüm seslendirilemedi.';
        setError(moreRemaining ? `${reason} Kalan bölümler okunuyor.` : reason);
      },
    });
  }, [settings, stopListening, clearAudio, startBargeInMonitor, stopBargeInMonitor]);

  const beginSpeechStream = useCallback((opts?: SpeechOptions) => {
    if (!settings || settings.jarvisSpeechEngine === 'device') return null;
    const queue = startCloudSpeech(opts);
    if (!queue) return null;
    const buffer = createSpeechTextBuffer((text) => queue.push(text));
    return { push: buffer.push, finish: () => { buffer.finish(); queue.finish(); } };
  }, [settings, startCloudSpeech]);

  const speak = useCallback(
    (text: string, opts?: SpeechOptions) => {
      if (typeof window === 'undefined' || !text.trim()) return;
      stopListening();
      clearAudio();
      voiceRequestRef.current = null;
      utteranceRef.current = null;
      const native = (window as any).webkit?.messageHandlers?.chloeMac;
      setError(null);
      // Cihaz sesi de madde imi/emoji/tablo okumamalı. Yalnızca kod veya
      // bağlantıdan oluşan yanıtta tam sessizlik yerine kısa bir bilgi verilir.
      const spoken = cleanSpeechText(text) || 'Yanıt ekranda.';
      if (settings && settings.jarvisSpeechEngine !== 'device') {
        const queue = startCloudSpeech(opts);
        splitSpeechText(spoken).forEach((chunk) => queue?.push(chunk));
        queue?.finish();
        return;
      }
      setIsPreparingSpeech(false);
      if (native) {
        const id = `voice-${++voiceSequenceRef.current}`;
        voiceRequestRef.current = { id, onEnd: opts?.onEnd };
        setIsPreparingSpeech(true);
        setIsSpeaking(false);
        nativeSpeechStartTimerRef.current = window.setTimeout(() => {
          if (voiceRequestRef.current?.id !== id) return;
          voiceRequestRef.current = null;
          nativeSpeechStartTimerRef.current = null;
          setIsPreparingSpeech(false);
          setIsSpeaking(false);
          setError('macOS sesli yanıtı başlatamadı. Cihaz sesini veya başka bir Türkçe kadın sesini dene.');
          opts?.onEnd?.();
        }, 15000);
        try {
          native.postMessage({ action: 'speakText', command: spoken, url: opts?.voiceURI, speechId: id, rate: opts?.rate, pitch: opts?.pitch });
        } catch (cause) {
          clearNativeSpeechStartTimer();
          voiceRequestRef.current = null;
          setIsPreparingSpeech(false);
          setIsSpeaking(false);
          setError(cause instanceof Error ? cause.message : 'Sesli yanıt başlatılamadı.');
          opts?.onEnd?.();
        }
        return;
      }
      if (!('speechSynthesis' in window)) {
        setError('Bu tarayıcı sesli yanıtı desteklemiyor.');
        opts?.onEnd?.();
        return;
      }
      window.speechSynthesis.cancel();

      const available = window.speechSynthesis.getVoices()
        .filter((voice) => voice.lang.toLowerCase().startsWith('tr') && FEMALE_VOICE_NAME.test(voice.name));
      const selectedVoice = available.find((voice) => voice.voiceURI === opts?.voiceURI) || available[0];
      if (!selectedVoice) {
        setError('Cihazda tanınan bir Türkçe kadın sesi yok. İşletim sistemi ayarlarından Türkçe kadın sesi ekleyip JARVIS’i yeniden aç.');
        setIsSpeaking(false);
        setIsPreparingSpeech(false);
        opts?.onEnd?.();
        return;
      }
      const utter = new SpeechSynthesisUtterance(spoken);
      utteranceRef.current = utter;
      setIsPreparingSpeech(true);
      setIsSpeaking(false);
      utter.lang = lang;
      utter.voice = selectedVoice;
      utter.rate = opts?.rate ?? 0.96;
      utter.pitch = opts?.pitch ?? 1;

      nativeSpeechStartTimerRef.current = window.setTimeout(() => {
        if (utteranceRef.current !== utter) return;
        utteranceRef.current = null;
        nativeSpeechStartTimerRef.current = null;
        setIsPreparingSpeech(false);
        setIsSpeaking(false);
        setError('Cihaz sesli yanıtı başlatamadı. Başka bir Türkçe kadın sesi veya ana API sesini dene.');
        opts?.onEnd?.();
      }, 15000);
      utter.onstart = () => {
        if (utteranceRef.current !== utter) return;
        clearNativeSpeechStartTimer();
        setIsPreparingSpeech(false);
        setIsSpeaking(true);
      };
      utter.onend = () => {
        if (utteranceRef.current !== utter) return;
        clearNativeSpeechStartTimer();
        utteranceRef.current = null;
        setIsPreparingSpeech(false);
        setIsSpeaking(false);
        opts?.onEnd?.();
      };
      utter.onerror = (event) => {
        if (utteranceRef.current !== utter) return;
        clearNativeSpeechStartTimer();
        utteranceRef.current = null;
        setIsPreparingSpeech(false);
        setIsSpeaking(false);
        setError(`Sesli yanıt oynatılamadı: ${event.error}. Ses çıkışını ve yüklü Türkçe sesi kontrol et.`);
        opts?.onEnd?.();
      };

      try {
        window.speechSynthesis.speak(utter);
      } catch (cause: unknown) {
        clearNativeSpeechStartTimer();
        utteranceRef.current = null;
        setIsPreparingSpeech(false);
        setIsSpeaking(false);
        setError(cause instanceof Error ? `Sesli yanıt başlatılamadı: ${cause.message}` : 'Sesli yanıt başlatılamadı.');
        opts?.onEnd?.();
      }
    },
    [lang, settings, clearAudio, clearNativeSpeechStartTimer, stopListening, startCloudSpeech]
  );

  const stopSpeaking = useCallback(() => {
    stopBargeInMonitor();
    clearAudio(); setIsPreparingSpeech(false);
    clearNativeSpeechStartTimer();
    voiceRequestRef.current = null;
    utteranceRef.current = null;
    const native = typeof window !== 'undefined' && (window as any).webkit?.messageHandlers?.chloeMac;
    if (native) native.postMessage({ action: 'stopSpeaking' });
    setIsSpeaking(false);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  }, [clearAudio, clearNativeSpeechStartTimer, stopBargeInMonitor]);

  // A provider/key change must not continue playing the previous provider's
  // in-flight response or unexpectedly restart its microphone loop.
  useEffect(() => () => { stopSpeaking(); stopListening(); }, [
    settings?.provider, settings?.cloudProvider, settings?.apiKey, settings?.apiBaseUrl,
    settings?.cloudModel, settings?.customModel, settings?.jarvisSpeechEngine,
    settings?.jarvisProvider, settings?.jarvisApiKey, settings?.jarvisModel, settings?.jarvisApiBaseUrl,
    settings?.jarvisSpeechProvider, settings?.jarvisSpeechApiKey, settings?.jarvisSpeechModel, settings?.jarvisSpeechApiBaseUrl,
    settings?.customSpeechModel, settings?.customSpeechVoice, stopSpeaking, stopListening,
  ]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isListening,
    isStarting,
    isSpeaking,
    isPreparingSpeech,
    speechIsOnDevice,
    sttSupported,
    ttsSupported,
    femaleVoices,
    error,
    clearError,
    startListening,
    finishListening,
    stopListening,
    openPrivacySettings,
    speak,
    beginSpeechStream,
    stopSpeaking,
  };
}
