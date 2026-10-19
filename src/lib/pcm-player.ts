/** Schedule incoming PCM without waiting for the complete spoken sentence. */
export async function playPcmResponse(response: Response, callerSignal: AbortSignal, onStart: () => void) {
  const signal = AbortSignal.any([callerSignal, AbortSignal.timeout(90000)]);
  if (!response.body) throw new Error('Ses akışı boş.');
  const context = new AudioContext({ sampleRate: 24000 });
  const reader = response.body.getReader(), sources = new Set<AudioBufferSourceNode>();
  let pendingByte: number | undefined, nextTime = 0, started = false, bytes = 0;
  let resumeTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => { void reader.cancel().catch(() => {}); for (const source of sources) { try { source.stop(); } catch {} } void context.close().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    signal.throwIfAborted();
    await Promise.race([context.resume(), new Promise<never>((_, reject) => { resumeTimer = setTimeout(() => reject(new Error('Ses oynatmak için Sesi dene düğmesine dokun.')), 3000); })]);
    clearTimeout(resumeTimer);
    while (!signal.aborted) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength; if (bytes > 25 * 1024 * 1024) throw new Error('Ses boyut sınırı aşıldı.');
      const data = new Uint8Array(value.length + (pendingByte === undefined ? 0 : 1));
      if (pendingByte !== undefined) { data[0] = pendingByte; data.set(value, 1); } else data.set(value);
      pendingByte = data.length % 2 ? data[data.length - 1] : undefined;
      const samples = Math.floor(data.length / 2); if (!samples) continue;
      const buffer = context.createBuffer(1, samples, 24000), channel = buffer.getChannelData(0), view = new DataView(data.buffer);
      for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); };
      nextTime = Math.max(nextTime, context.currentTime + 0.03);
      source.start(nextTime); nextTime += buffer.duration;
      if (!started) { started = true; onStart(); }
      while (!signal.aborted && nextTime - context.currentTime > 2) await new Promise(resolve => setTimeout(resolve, 30));
    }
    signal.throwIfAborted();
    if (!started || pendingByte !== undefined) throw new Error('Ses akışı eksik veya boş.');
    while (sources.size && !signal.aborted) await new Promise(resolve => setTimeout(resolve, 20));
    signal.throwIfAborted();
  } finally {
    clearTimeout(resumeTimer); signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {}); reader.releaseLock();
    for (const source of sources) { try { source.stop(); } catch {} source.disconnect(); }
    await context.close().catch(() => {});
  }
}
