import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function harness(allowed = true) {
  const exports = {}, calls = [];
  const source = fs.readFileSync(new URL('../src/app/api/stt/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, Buffer, require: name => {
    if (name === 'next/server') return { NextResponse: Response };
    if (name === '@/lib/request-origin') return { localRequestAllowed: () => allowed };
    if (name === '@/lib/deepgram-stt') return { DeepgramSTTClient: class {
      async transcribe(buffer, signal) { calls.push({ buffer, signal }); return { text: 'Merhaba', confidence: 1, isFinal: true }; }
    } };
    throw Error(name);
  } });
  return { post: exports.POST, calls };
}
const request = body => new Request('http://127.0.0.1:3004/api/stt', { method: 'POST', body: JSON.stringify(body) });

test('STT rejects foreign origin before parsing', async () => {
  const h = harness(false);
  assert.equal((await h.post(request({}))).status, 403);
  assert.equal(h.calls.length, 0);
});
test('STT rejects invalid JSON, object shape and malformed audio without upstream work', async () => {
  const h = harness();
  const bad = [null, [], {}, { apiKey: 'test', audioBase64: '%%%' }, { apiKey: 'test', audio: [1, 2] }, { apiKey: 'test', audioBase64: '====' }];
  for (const value of bad) assert.equal((await h.post(request(value))).status, 400);
  assert.equal((await h.post(new Request('http://127.0.0.1', { method: 'POST', body: '{' }))).status, 400);
  assert.equal(h.calls.length, 0);
});
test('STT limits both declared and chunked body size', async () => {
  const h = harness();
  assert.equal((await h.post(new Request('http://127.0.0.1', { method: 'POST', headers: { 'content-length': '9000000' }, body: '{}' }))).status, 413);
  assert.equal((await h.post(new Request('http://127.0.0.1', { method: 'POST', body: 'x'.repeat(8_016_001) }))).status, 413);
  assert.equal(h.calls.length, 0);
});
test('STT decodes once and forwards request cancellation signal', async () => {
  const h = harness();
  const req = request({ apiKey: 'test', audioBase64: Buffer.from('fixture').toString('base64') });
  const response = await h.post(req);
  assert.equal(response.status, 200);
  assert.equal(h.calls[0].buffer.toString(), 'fixture');
  assert.equal(h.calls[0].signal, req.signal);
  assert.equal((await response.json()).text, 'Merhaba');
});
