/**
 * Kısa, dosyasız ses geri bildirimleri (Web Audio osilatörleri).
 * Referans Jarvis uygulamasındaki yaklaşım: ses dosyası yüklemek yerine
 * osilatörle ton üretmek — sıfır asset, sıfır ağ, anında çalma.
 *
 * Kullanıcı mikrofonun ne zaman açıldığını/kapandığını duyar; "mikrofon
 * aniden kesildi" belirsizliğini ortadan kaldırır.
 */

export type AudioCue = 'mic-open' | 'mic-close' | 'blocked';

interface CueNote {
  frequency: number;
  durationMs: number;
  gain: number;
  delayMs: number;
}

/** Her sinyal için nota dizisi (referans uygulamadaki 2-3 osilatör deseni). */
export const AUDIO_CUES: Record<AudioCue, CueNote[]> = {
  // Açılış: yükselen iki ton — "dinliyorum"
  'mic-open': [
    { frequency: 660, durationMs: 90, gain: 0.02, delayMs: 0 },
    { frequency: 990, durationMs: 110, gain: 0.018, delayMs: 70 },
  ],
  // Kapanış: düşen tek ton — "bitti"
  'mic-close': [{ frequency: 520, durationMs: 120, gain: 0.016, delayMs: 0 }],
  // Engel/izin sorunu: alçak çift ton
  blocked: [
    { frequency: 300, durationMs: 140, gain: 0.02, delayMs: 0 },
    { frequency: 220, durationMs: 160, gain: 0.02, delayMs: 120 },
  ],
};

/** Test edilebilir toplam süre hesabı. */
export function cueDuration(cue: AudioCue): number {
  return AUDIO_CUES[cue].reduce((total, note) => Math.max(total, note.delayMs + note.durationMs), 0);
}

export interface CueContext {
  currentTime: number;
  destination: unknown;
  createOscillator: () => {
    type: string;
    frequency: { setValueAtTime: (value: number, at: number) => void };
    connect: (node: unknown) => void;
    start: (at: number) => void;
    stop: (at: number) => void;
  };
  createGain: () => {
    gain: {
      setValueAtTime: (value: number, at: number) => void;
      exponentialRampToValueAtTime: (value: number, at: number) => void;
    };
    connect: (node: unknown) => void;
  };
}

/** Verilen AudioContext üzerinde sinyali çalar. Hata durumunda sessizce vazgeçer. */
export function playCueOn(context: CueContext, cue: AudioCue): void {
  try {
    for (const note of AUDIO_CUES[cue]) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const start = context.currentTime + note.delayMs / 1000;
      const end = start + note.durationMs / 1000;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(note.frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(end + 0.02);
    }
  } catch {
    /* Ses geri bildirimi isteğe bağlıdır; başarısız olursa akış sürer. */
  }
}

let sharedContext: AudioContext | null = null;

/** Tarayıcıda tek paylaşılan AudioContext ile sinyali çalar. */
export function playAudioCue(cue: AudioCue): void {
  if (typeof window === 'undefined') return;
  try {
    const legacy = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = legacy.AudioContext || legacy.webkitAudioContext;
    if (!Ctor) return;
    if (!sharedContext || sharedContext.state === 'closed') sharedContext = new Ctor();
    if (sharedContext.state === 'suspended') void sharedContext.resume().catch(() => {});
    playCueOn(sharedContext as unknown as CueContext, cue);
  } catch {
    /* Sessizce yok say. */
  }
}
