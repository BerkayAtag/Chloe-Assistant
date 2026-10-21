import test from 'node:test';
import assert from 'node:assert/strict';
import { voiceContext } from '../src/lib/voice-context.ts';
test('voice history is bounded by characters and recent turns', () => {
  const messages = Array.from({length:20}, (_, i) => ({role:'user',content:String(i).repeat(1000)}));
  const result = voiceContext(messages);
  assert.ok(result.length <= 8);
  assert.ok(result.reduce((sum,m)=>sum+m.content.length,0)<=8000);
  assert.equal(result.at(-1),messages.at(-1)); assert.equal(messages.length,20);
});
test('current long instruction and attachments are never truncated', () => {
  const last={content:'a'.repeat(12000),attachments:[{mimeType:'image/png'}]};
  assert.deepEqual(voiceContext([{content:'old'},last]),[last]);
});
test('history remains contiguous and preserves message objects', () => {
  const messages=[{content:'one'},{content:'x'.repeat(9000)},{content:'last'}];
  assert.deepEqual(voiceContext(messages),[messages[2]]);
  assert.deepEqual(voiceContext([]),[]);
});
