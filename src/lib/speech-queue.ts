/** Bounded look-ahead: prepare the next clip while the current one plays. */
export function createSpeechQueue<T>(options: {
  signal: AbortSignal;
  prepare: (text: string) => Promise<T>;
  play: (value: T) => Promise<void>;
  preparing: () => void;
  ended: () => void;
  failed: (error: unknown) => void;
}) {
  type Result = { value: T; error?: never } | { error: unknown; value?: never };
  const entries: { text: string; ready?: Promise<Result> }[] = [];
  let cursor = 0, busy = false, finished = false, settled = false, chars = 0;
  const prepare = (index: number) => {
    const entry = entries[index];
    if (entry && !entry.ready) entry.ready = options.prepare(entry.text)
      .then((value): Result => ({ value }), (error): Result => ({ error }));
  };
  const pump = async () => {
    if (busy || settled || options.signal.aborted) return;
    busy = true;
    try {
      while (cursor < entries.length && !options.signal.aborted) {
        options.preparing();
        prepare(cursor);
        prepare(cursor + 1);
        const result = await entries[cursor].ready!;
        if (options.signal.aborted) return;
        if ('error' in result) throw result.error;
        await options.play(result.value as T);
        // Release the Blob/promise of the played clip, not just its object URL.
        entries[cursor].ready = undefined;
        entries[cursor].text = '';
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
