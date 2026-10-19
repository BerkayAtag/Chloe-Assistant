/**
 * Barge-in (konuşmayı sesle kesme) için ses enerjisi algılama.
 *
 * Asistan konuşurken mikrofon enerjisi eşiğin üzerinde `holdMs` boyunca kalırsa
 * "kullanıcı söze girdi" sinyali üretilir. Yanlış tetiklemeyi önlemek için
 * tek karelik ses yeterli değildir; enerjinin süreklilik göstermesi gerekir.
 */

export interface BargeInConfig {
  /** RMS eşiği (0..1). Varsayılan konuşma sesine göre ölçülmüştür. */
  threshold: number;
  /** Eşik üstünde kesintisiz kalması gereken süre (ms). */
  holdMs: number;
}

export const DEFAULT_BARGE_IN: BargeInConfig = { threshold: 0.045, holdMs: 220 };

export interface BargeInDetector {
  /** Enerji örneği besler; kesme gerekiyorsa true döner (yalnızca bir kez). */
  push(level: number): boolean;
  /** Yeni bir konuşma turu için sıfırlar. */
  reset(): void;
  /** Henüz tetiklenmediyse true. */
  readonly armed: boolean;
}

export function createBargeInDetector(
  config: BargeInConfig = DEFAULT_BARGE_IN,
  now: () => number = () => Date.now()
): BargeInDetector {
  let aboveSince: number | null = null;
  let fired = false;
  return {
    push(level: number): boolean {
      if (fired || !Number.isFinite(level)) return false;
      const current = now();
      if (level >= config.threshold) {
        if (aboveSince === null) {
          aboveSince = current;
          // Eşiğin hemen üstündeki tek kare: süre dolmadıysa tetiklenmez.
          return config.holdMs <= 0;
        }
        if (current - aboveSince >= config.holdMs) {
          fired = true;
          return true;
        }
      } else {
        aboveSince = null;
      }
      return false;
    },
    reset() {
      aboveSince = null;
      fired = false;
    },
    get armed() {
      return !fired;
    },
  };
}

/** AnalyserNode örneklerinden RMS seviyesi (0..1) hesaplar. */
export function rmsLevel(samples: Float32Array | number[]): number {
  const length = samples.length;
  if (!length) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    const value = samples[index];
    sum += value * value;
  }
  return Math.sqrt(sum / length);
}
