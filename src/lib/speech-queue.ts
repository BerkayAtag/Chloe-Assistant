/** Bounded look-ahead: prepare the next clip while the current one plays. */
export function createSpeechQueue<T>(options: {
  signal: AbortSignal;
  prepare: (text: string) => Promise<T>;
  play: (value: T) => Promise<void>;
  preparing: () => void;
  ended: () => void;
  failed: (error: unknown) => void;
  /** Configuration/auth/quota errors must end the whole turn, not retry clips. */
  shouldRetry?: (error: unknown) => boolean;
  /** Tek bir klip üretilemediğinde çağrılır; okuma kalan kliplerle sürer.
   *  `moreRemaining` o anda okunmayı bekleyen başka klip olup olmadığını bildirir. */
  skipped?: (error: unknown, moreRemaining: boolean) => void;
}) {
  type Result = { value: T; error?: never } | { error: unknown; value?: never };
  const entries: { text: string; ready?: Promise<Result> }[] = [];
  let cursor = 0, busy = false, finished = false, settled = false, chars = 0;
  const prepare = (index: number) => {
    const entry = entries[index];
    if (!entry || entry.ready) return;
    // `prepare` çağrısı SENKRON başlatılır (zamanlama korunur); yalnızca senkron
    // fırlatma yakalanır, aksi hâlde `ready` tanımsız kalıp kuyruk ölür.
    let pending: Promise<T>;
    try {
      pending = options.prepare(entry.text);
    } catch (error) {
      entry.ready = Promise.resolve({ error } as Result);
      return;
    }
    entry.ready = pending.then((value): Result => ({ value }), (error): Result => ({ error }));
  };
  const dropEntry = (index: number) => {
    entries[index].ready = undefined;
    entries[index].text = '';
  };
  const pump = async () => {
    if (busy || settled || options.signal.aborted) return;
    busy = true;
    try {
      while (cursor < entries.length && !options.signal.aborted) {
        options.preparing();
        prepare(cursor);
        prepare(cursor + 1);
        let result = await entries[cursor].ready!;
        if (options.signal.aborted) return;
        if ('error' in result) {
          if (options.shouldRetry?.(result.error) === false) throw result.error;
          // Tek klip hatası tüm sesli yanıtı iptal etmemeli: AYNI metinle bir kez
          // yeniden denenir, yine olmazsa yalnızca o klip atlanır ve okuma sürer.
          // (Metin burada silinmez; silinirse yeniden deneme boş klip üretir.)
          entries[cursor].ready = undefined;
          prepare(cursor);
          result = await entries[cursor].ready!;
          if (options.signal.aborted) return;
          if ('error' in result) {
            if (options.shouldRetry?.(result.error) === false) throw result.error;
            dropEntry(cursor);
            cursor++;
            options.skipped?.(result.error, cursor < entries.length);
            continue;
          }
        }
        await options.play(result.value as T);
        // Release the Blob/promise of the played clip, not just its object URL.
        dropEntry(cursor);
        cursor++;
      }
      if (finished && !options.signal.aborted) { settled = true; options.ended(); }
    } catch (error) {
      if (!options.signal.aborted) { settled = true; options.failed(error); }
    } finally { busy = false; }
  };
  return {
    push(text: string) {
      if (!text.trim() || finished || settled || options.signal.aborted) return;
      chars += text.length;
      if (chars > 60000) { settled = true; options.failed(new Error('Sesli yanıt sınırı aşıldı; kalan metin ekranda.')); return; }
      entries.push({ text });
      // A clip may arrive after playback already started.
      if (busy && entries.length - 1 === cursor + 1) prepare(cursor + 1);
      void pump();
    },
    finish() { finished = true; void pump(); },
  };
}
