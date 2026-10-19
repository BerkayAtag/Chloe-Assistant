import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiPcmStream } from '../src/lib/gemini-pcm-stream.ts';
import { playPcmResponse } from '../src/lib/pcm-player.ts';
const encode = new TextEncoder();
const event = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const audio = event({ event_type: 'step.delta', delta: { type: 'audio', data: 'AID/fw==' } });
const end = event({ event_type: 'interaction.completed' });
const sse = (body) => new Response(body, { headers: { 'content-type': 'text/event-stream' } });
test('PCM reaches the consumer before synthesis completes across split SSE frames', async () => {
  let producer;
  const input = new ReadableStream({ start(c) { producer = c; } });
  const reader = geminiPcmStream(sse(input)).getReader();
  for (const part of encode.encode(audio)) producer.enqueue(Uint8Array.of(part));
  assert.deepEqual([...((await reader.read()).value)], [0, 128, 255, 127]);
  producer.enqueue(encode.encode(end)); producer.close();
  assert.equal((await reader.read()).done, true);
});
test('provider errors never forward raw credentials or incomplete success', async () => {
  const broken = sse(audio + event({ event_type: 'error', message: 'synthetic-secret' }));
  await assert.rejects(new Response(geminiPcmStream(broken)).arrayBuffer(), error => !error.message.includes('synthetic-secret'));
  await assert.rejects(new Response(geminiPcmStream(sse(audio))).arrayBuffer(), /tamamlanamadı/);
});
test('empty, odd-length and non-SSE audio are rejected', async () => {
  assert.throws(() => geminiPcmStream(new Response('html')), /biçimi/);
  for (const body of [end, event({ event_type: 'step.delta', delta: { type: 'audio', data: 'AQ==' } }) + end]) {
    await assert.rejects(new Response(geminiPcmStream(sse(body))).arrayBuffer());
  }
});
test('stream cancellation cancels upstream reading', async () => {
  let cancelled = false;
  const reader = geminiPcmStream(sse(new ReadableStream({ cancel() { cancelled = true; } }))).getReader();
  await reader.cancel(); assert.equal(cancelled, true);
});
test('provider DONE sentinel is accepted only with a successful typed completion', async () => {
  const bytes = await new Response(geminiPcmStream(sse(audio + end + 'data: [DONE]\n\n'))).arrayBuffer();
  assert.deepEqual([...new Uint8Array(bytes)], [0, 128, 255, 127]);
  await assert.rejects(new Response(geminiPcmStream(sse(audio + 'data: [DONE]\n\n'))).arrayBuffer(), /tamamlanamadı/);
});
function mockAudioContext(run) {
  const previous = globalThis.AudioContext; const samples = [], sources = []; let closes = 0;
  globalThis.AudioContext = class {
    currentTime = 0; destination = {};
    async resume() {}
    async close() { closes++; }
    createBuffer(_channels, size, rate) { const data = new Float32Array(size); samples.push(data); return { duration: size/rate, getChannelData() { return data; } }; }
    createBufferSource() { const source = { connect() {}, disconnect() {}, stop() { this.stopped = true; }, start() { queueMicrotask(() => this.onended?.()); } }; sources.push(source); return source; }
  };
  return run({ samples, sources, get closes() { return closes; } }).finally(() => { globalThis.AudioContext = previous; });
}
test('PCM playback preserves signed samples split between odd byte chunks and starts once', () => mockAudioContext(async state => {
  let starts = 0;
  const body = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(0)); c.enqueue(Uint8Array.of(128,255)); c.enqueue(Uint8Array.of(127)); c.close(); } });
  await playPcmResponse(new Response(body), new AbortController().signal, () => starts++);
  assert.equal(starts, 1); assert.deepEqual(state.samples.flatMap(x=>[...x]), [-1, 32767/32768]); assert.ok(state.closes > 0);
}));
test('aborting PCM playback releases the pending network read and audio context', () => mockAudioContext(async state => {
  let cancelled = false; const abort = new AbortController();
  const body = new ReadableStream({ start(c) { c.enqueue(Uint8Array.of(0,0)); }, cancel() { cancelled = true; } });
  await assert.rejects(playPcmResponse(new Response(body), abort.signal, () => abort.abort()));
  assert.equal(cancelled, true); assert.ok(state.closes > 0);
}));
test('PCM player rejects an incomplete final sample', () => mockAudioContext(async () => {
  await assert.rejects(playPcmResponse(new Response(Uint8Array.of(1)), new AbortController().signal, ()=>{}), /eksik/);
}));
