/** Bounded provider SSE -> 24 kHz mono signed little-endian PCM.
 * Only audio bytes cross this boundary, never provider errors or metadata. */
export function geminiPcmStream(response: Response): ReadableStream<Uint8Array> {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Ses akışı biçimi geçersiz.');
  const reader = response.body.getReader(); let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const decoder = new TextDecoder(); let pending = '', bytes = 0, completed = false, received = 0;
      const line = (raw: string) => {
        if (raw.length > 2 * 1024 * 1024) throw new Error('Ses çerçevesi çok büyük.');
        if (!raw.startsWith('data:')) return;
        const payload = raw.slice(5).trim();
        // Interactions may append an SSE transport sentinel after the typed
        // completion event. It is not JSON and is not itself proof of success.
        if (payload === '[DONE]') return;
        const event = JSON.parse(payload);
        if (event.event_type === 'error' || event.event_type === 'interaction.failed') throw new Error('Ses sağlayıcısı akışı tamamlayamadı.');
        if (event.event_type === 'interaction.completed') completed = true;
        if (event.event_type !== 'step.delta' || event.delta?.type !== 'audio') return;
        if (typeof event.delta.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(event.delta.data)) throw new Error('Ses verisi geçersiz.');
        const audio = new Uint8Array(Buffer.from(event.delta.data, 'base64'));
        bytes += audio.byteLength;
        if (bytes > 25 * 1024 * 1024) throw new Error('Ses akışı boyut sınırını aştı.');
        if (audio.length) controller.enqueue(audio);
      };
      try {
        while (!cancelled) {
          const { value, done } = await reader.read(); if (done) break;
          received += value.byteLength;
          if (received > 40 * 1024 * 1024) throw new Error('Ses akışı boyut sınırını aştı.');
          pending += decoder.decode(value, { stream: true });
          let newline;
          while ((newline = pending.indexOf('\n')) >= 0) { line(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
          if (pending.length > 2 * 1024 * 1024) throw new Error('Ses çerçevesi çok büyük.');
        }
        if (cancelled) return;
        pending += decoder.decode(); if (pending.trim()) line(pending);
        if (!completed || !bytes || bytes % 2) throw new Error('Ses akışı eksik veya boş.');
        controller.close();
      } catch {
        if (!cancelled) controller.error(new Error('Ses akışı tamamlanamadı. Metin ekranda; yeniden deneyebilirsin.'));
        await reader.cancel().catch(() => {});
      } finally { reader.releaseLock(); }
    },
    cancel() { cancelled = true; return reader.cancel().catch(() => {}); },
  });
}
