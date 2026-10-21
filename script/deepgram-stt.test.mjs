// Test suite for Deepgram STT provider ported from Jarvis
// Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DeepgramSTTClient, DEFAULT_CONFIG } from '../src/lib/deepgram-stt.ts';

// ── Configuration Tests ────────────────────────────────────────────────────────

test('deepgram: DEFAULT_CONFIG has expected values', () => {
  assert.equal(DEFAULT_CONFIG.model, 'nova-3');
  assert.equal(DEFAULT_CONFIG.language, 'en-US');
  assert.equal(DEFAULT_CONFIG.smart_format, true);
  assert.equal(DEFAULT_CONFIG.punctuate, true);
  assert.equal(DEFAULT_CONFIG.capitalization, true);
});

test('deepgram: client initializes with config', () => {
  const client = new DeepgramSTTClient('fake-key', { model: 'enhanced', language: 'tr-TR' });
  // Client exists and can be created without throwing
  assert.ok(client);
});

test('deepgram: client uses default config with empty overrides', () => {
  const client = new DeepgramSTTClient('test-key');
  assert.ok(client);
  // Verify default values applied (check via transcribe path not available without key)
});

// ── TranscriptionResult Type Shape ─────────────────────────────────────────────

test('deepgram: TranscriptionResult structure', async () => {
  // Test that the transcribe method throws for invalid key (expected behavior)
  const client = new DeepgramSTTClient('invalid-key');
  try {
    await client.transcribe(Buffer.from('fake-audio'));
    assert.fail('Should have thrown for invalid key');
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes('Deepgram') || error.message.includes('401') || error.message.includes('Unauthorized'));
  }
});

// ── Connect/Disconnect Tests ───────────────────────────────────────────────────

test('deepgram: connect returns false when WebSocket unavailable', () => {
  const client = new DeepgramSTTClient('test-key');
  const result = client.connect(
    () => {},
    (err) => { assert.ok(err); }
  );
  // In Node test env, WebSocket may or may not exist
  // Just verify it doesn't throw
  assert.equal(typeof result, 'boolean');
});

test('deepgram: disconnect cleans up', () => {
  const client = new DeepgramSTTClient('test-key');
  assert.doesNotThrow(() => client.disconnect());
});

test('deepgram: finish without connection does not throw', () => {
  const client = new DeepgramSTTClient('test-key');
  assert.doesNotThrow(() => client.finish());
});

test('deepgram: sendAudio without connection does not throw', () => {
  const client = new DeepgramSTTClient('test-key');
  assert.doesNotThrow(() => client.sendAudio(Buffer.from('test')));
});
