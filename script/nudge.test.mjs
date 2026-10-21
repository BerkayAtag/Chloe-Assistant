// Test suite for Jarvis nudge system ported to Chloe
// Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, checkNudges, buildNudgeContext, DEFAULT_NUDGES } from '../src/lib/nudge.ts';

// --- analyzeText Tests ---
test('analyze: complete sentence', () => {
  const result = analyzeText('Hello, how are you today?');
  assert.equal(result.endsAbruptly, false);
  assert.equal(result.hasOpenCodeBlock, false);
  assert.equal(result.wordCount, 5);
});

test('analyze: abrupt ending', () => {
  const result = analyzeText('So the main thing is');
  assert.equal(result.endsAbruptly, true);
  assert.equal(result.hasOpenCodeBlock, false);
});

test('analyze: open code block', () => {
  const result = analyzeText('Here is the code:\n```js\nconst x = 1;');
  assert.equal(result.hasOpenCodeBlock, true);
});

test('analyze: closed code block', () => {
  const result = analyzeText('Here is the code:\n```js\nconst x = 1;\n```');
  assert.equal(result.hasOpenCodeBlock, false);
});

test('analyze: empty text', () => {
  const result = analyzeText('');
  assert.equal(result.wordCount, 0);
  assert.equal(result.endsAbruptly, false);
});

// --- checkNudges Tests ---
test('nudge: incomplete sentence triggers', () => {
  const ctx = buildNudgeContext('The function takes three arguments and returns', false);
  const result = checkNudges(ctx);
  assert.ok(result);
  assert.equal(result?.trigger.id, 'incomplete-sentence');
});

test('nudge: open code block triggers', () => {
  const ctx = buildNudgeContext('```js\nconst x = 1;', false);
  const result = checkNudges(ctx);
  assert.ok(result);
  assert.equal(result?.trigger.id, 'open-code-block');
});

test('nudge: too short triggers', () => {
  const ctx = buildNudgeContext('yes', false);
  const result = checkNudges(ctx);
  assert.ok(result);
  assert.equal(result?.trigger.id, 'too-short');
});

test('nudge: complete sentence does NOT trigger', () => {
  const ctx = buildNudgeContext('Here is the answer you requested.', false);
  const result = checkNudges(ctx);
  assert.equal(result, null);
});

test('nudge: user follow-up prevents trigger', () => {
  const ctx = buildNudgeContext('So the main thing is', true);
  const result = checkNudges(ctx);
  assert.equal(result, null);
});

test('nudge: templates have content', () => {
  for (const trigger of DEFAULT_NUDGES) {
    assert.ok(typeof trigger.id === 'string');
    assert.ok(typeof trigger.template === 'function');
    assert.ok(typeof trigger.cooldown === 'number');
    assert.ok(trigger.template(buildNudgeContext('', false)).length > 0);
  }
});

test('nudge: priority order (too-short before incomplete)', () => {
  const ctx = buildNudgeContext('hello world', false);
  const result = checkNudges(ctx);
  assert.ok(result);
  assert.equal(result?.trigger.id, 'too-short');
});
