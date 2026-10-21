// Test suite for Jarvis dictation cleaning ported to Chloe
// Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jarvisDictationClean, cleanSpeechText } from '../src/lib/speech-text.ts';

// ── Jarvis Dictation Cleaning Tests ──────────────────────────────────────────

test('dictation: removes filler words', () => {
  assert.equal(jarvisDictationClean('um hello world'), 'hello world');
  assert.equal(jarvisDictationClean('uh what is this'), 'what is this');
  assert.equal(jarvisDictationClean('ah i think so'), 'i think so');
});

test('dictation: fixes common homophones', () => {
  assert.equal(jarvisDictationClean('their is a problem'), "they're a problem");
  assert.equal(jarvisDictationClean('write to the file'), 'right to the file');
});

test('dictation: converts file extensions', () => {
  assert.equal(jarvisDictationClean('open readme dot md'), 'open readme.md');
  assert.equal(jarvisDictationClean('config dot json is broken'), 'config.json is broken');
  assert.equal(jarvisDictationClean('edit main dot ts'), 'edit main.ts');
});

test('dictation: converts spoken emojis', () => {
  assert.equal(jarvisDictationClean('fire emoji for this'), '🔥 for this');
  assert.equal(jarvisDictationClean('thumbs up emoji'), '👍');
  assert.equal(jarvisDictationClean('heart emoji'), '❤️');
  assert.equal(jarvisDictationClean('smiling face'), '😊');
});

test('dictation: preserves signatures', () => {
  // "Best, John" should NOT be modified
  assert.equal(jarvisDictationClean('see you tomorrow best john'), 'see you tomorrow best john');
  assert.equal(jarvisDictationClean('thanks regards sarah'), 'thanks regards sarah');
});

test('dictation: handles self-corrections in text', () => {
  // 4PM till 3PM → 3PM (self-correction logic is model-side, but we preserve)
  assert.equal(jarvisDictationClean('meet at 4PM till 3PM'), 'meet at 4PM till 3PM');
});

test('dictation: empty and edge cases', () => {
  assert.equal(jarvisDictationClean(''), '');
  assert.equal(jarvisDictationClean('   '), '');
  assert.equal(jarvisDictationClean('normal text'), 'normal text');
});

// ── Integration with existing cleanSpeechText ────────────────────────────────

test('cleanSpeechText: removes markdown before dictation cleaning', () => {
  const mdText = 'Check `this` link: https://example.com and [text](url)';
  const cleaned = cleanSpeechText(mdText);
  // URLs should be removed, links should be text-only
  assert.ok(!cleaned.includes('https://'));
  assert.ok(!cleaned.includes('['));
  assert.ok(!cleaned.includes('('));
});

test('cleanSpeechText: preserves regular text content', () => {
  const text = 'Hello world, this is a test.';
  assert.equal(cleanSpeechText(text), text);
});
