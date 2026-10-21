// Test suite for Jarvis command parser ported to Chloe
// Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, buildClarificationPrompt } from '../src/lib/command-parser.ts';

// ── Command Parser Tests (ported from Jarvis) ─────────────────────────────────

// App/browser commands
test('command: ac YouTube', () => {
  const result = parseCommand('ac YouTube');
  assert.equal(result.intent, 'open_app');
  assert.equal(result.entities.target.toLowerCase(), 'youtube');
  assert.ok(result.confidence >= 0.9);
});

test('command: git github.com', () => {
  const result = parseCommand('git github.com');
  assert.equal(result.intent, 'open_browser');
  assert.equal(result.entities.url, 'github.com');
});

// Dictation commands
test('command: konus', () => {
  const result = parseCommand('konus');
  assert.equal(result.intent, 'dictation_start');
});

test('command: dur', () => {
  const result = parseCommand('dur');
  assert.equal(result.intent, 'dictation_stop');
});

// Search commands
test('command: hava durumu arastir', () => {
  const result = parseCommand('hava durumu arastir');
  assert.equal(result.intent, 'search');
  assert.equal(result.entities.query, 'hava durumu');
});

// Coding commands
test('command: Kodlama yap', () => {
  const result = parseCommand('Kodlama yap');
  assert.equal(result.intent, 'code_start');
  assert.ok(result.confidence >= 0.9);
});

test('command: hello.js dosyasini duzenle', () => {
  const result = parseCommand('hello.js dosyasini duzenle');
  assert.equal(result.intent, 'file_edit');
  assert.ok(result.confidence >= 0.85);
});

// Team commands
test('command: Ajan ekibini calistir', () => {
  const result = parseCommand('Ajan ekibini calistir');
  assert.equal(result.intent, 'team_start');
  assert.ok(result.confidence >= 0.75);
});

test('command: Ekibi durdur', () => {
  const result = parseCommand('Ekibi durdur');
  assert.equal(result.intent, 'team_stop');
});

// Report commands
test('command: Durum raporu', () => {
  const result = parseCommand('Durum raporu');
  assert.equal(result.intent, 'report');
});

test('command: rapor ver', () => {
  const result = parseCommand('rapor ver');
  assert.equal(result.intent, 'report');
});

// Ambiguous / clarification
test('command: ne yapabilirsin?', () => {
  const result = parseCommand('ne yapabilirsin?');
  assert.equal(result.intent, 'unknown');
  assert.ok(result.needsClarification);
  assert.ok(result.clarification);
});

test('command: ac', () => {
  const result = parseCommand('ac');
  assert.ok(result.needsClarification);
});

// English variants
test('command: open YouTube', () => {
  const result = parseCommand('open YouTube');
  assert.equal(result.intent, 'open_app');
  assert.equal(result.entities.target, 'youtube');
});

// Clarification prompt
test('clarification prompt structure', () => {
  const prompt = buildClarificationPrompt('test');
  assert.ok(prompt.includes('open_app'));
  assert.ok(prompt.includes('search'));
  assert.ok(prompt.includes('code_start'));
  assert.ok(prompt.includes('"intent"'));
});
