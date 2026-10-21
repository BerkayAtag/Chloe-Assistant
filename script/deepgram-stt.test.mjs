import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepgramSTTClient } from '../src/lib/deepgram-stt.ts';

class FakeSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  sent = [];
  closed = false;
  constructor(url, protocols) { this.url = url; this.protocols = protocols; FakeSocket.instances.push(this); }
  send(value) { this.sent.push(value); }
  close() { this.closed = true; }
  receive(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
function mockSocket(t) {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  t.after(() => { globalThis.WebSocket = original; });
}

test('stream authenticates with protocols and includes the PCM format', (t) => {
  mockSocket(t);
  const client = new DeepgramSTTClient('test-key');
  assert.equal(client.connect(() => {}), true);
  const socket = FakeSocket.instances.at(-1);
  assert.deepEqual(socket.protocols, ['token', 'test-key']);
  assert.equal(new URL(socket.url).searchParams.get('encoding'), 'linear16');
  assert.equal(new URL(socket.url).searchParams.get('sample_rate'), '16000');
  assert.ok(!socket.url.includes('test-key'));
  client.disconnect();
});

test('finish waits for streaming Results including zero confidence', (t) => {
  mockSocket(t);
  const results = [];
  const client = new DeepgramSTTClient('test-key');
  client.connect(r => results.push(r));
  const socket = FakeSocket.instances.at(-1);
  client.finish(); client.finish();
  assert.deepEqual(socket.sent, [JSON.stringify({ type: 'CloseStream' })]);
  assert.equal(socket.closed, false);
  socket.receive({ type: 'Results', channel: { alternatives: [{ transcript: 'Merhaba', confidence: 0 }] }, is_final: true, speech_final: true });
  assert.deepEqual(results, [{ text: 'Merhaba', confidence: 0, isFinal: true, speechFinal: true }]);
  client.sendAudio(Buffer.from('late'));
  assert.equal(socket.sent.length, 1);
  client.disconnect();
});

test('reconnect ignores old results and close events', (t) => {
  mockSocket(t);
  const client = new DeepgramSTTClient('test-key');
  const results = [];
  client.connect(r => results.push(r));
  const old = FakeSocket.instances.at(-1);
  client.connect(r => results.push(r));
  const current = FakeSocket.instances.at(-1);
  assert.equal(old.closed, true);
  old.receive({ channel: { alternatives: [{ transcript: 'stale' }] } });
  old.onclose();
  client.sendAudio(Buffer.from('current'));
  assert.equal(current.sent.length, 1);
  assert.equal(results.length, 0);
  client.disconnect();
});

test('constructor failures do not expose credentials', (t) => {
  t.mock.method(globalThis, 'WebSocket', function () { throw Error('secret-key'); });
  const errors = [];
  assert.equal(new DeepgramSTTClient('secret-key').connect(() => {}, e => errors.push(e)), false);
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].includes('secret-key'));
});

test('HTTP escapes options and propagates cancellation', async (t) => {
  const abort = new AbortController();
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).searchParams.get('callback'), null);
    assert.equal(init.headers.Authorization, 'Token test-key');
    assert.ok(init.signal instanceof AbortSignal);
    abort.abort();
    assert.equal(init.signal.aborted, true);
    return Response.json({ results: { channels: [{ alternatives: [{ transcript: 'Merhaba', confidence: 0 }] }] } });
  });
  const result = await new DeepgramSTTClient('test-key', { model: 'nova-3&callback=https://example.com' }).transcribe(Buffer.from('fixture'), abort.signal);
  assert.equal(result.confidence, 0);
  assert.equal(result.text, 'Merhaba');
});

test('HTTP error fixture does not access the network', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 401 }));
  await assert.rejects(new DeepgramSTTClient('test-key').transcribe(Buffer.from('fixture')), /401/);
});
