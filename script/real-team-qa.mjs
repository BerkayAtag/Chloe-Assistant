// Opt-in integration test: uses the saved connection and may incur provider cost.
// Only creates/edits an isolated temporary fixture; never changes the saved team.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
const headers = { 'Content-Type': 'application/json', Origin: base, 'x-chloe-settings': '1' };
const get = async (route) => (await fetch(base + route, { headers, signal: AbortSignal.timeout(10000) })).json();
const post = async (body) => {
  const response = await fetch(base + '/api/office', { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  assert.ok(response.ok, `Office HTTP ${response.status}`);
  return response.json();
};
const { connection } = await get('/api/settings');
assert.ok(!(await get('/api/office')).runs.some(r => ['running', 'planning'].includes(r.status)), 'Another team job is active');
const root = await fs.mkdtemp('/tmp/chloe-team-live.');
const source = 'export function greet(name) { return "Merhaba " + name + "!"; }\n';
await fs.writeFile(root + '/greet.js', source);
await fs.writeFile(root + '/package.json', JSON.stringify({ type: 'module' }));
const { run } = await post({ action: 'start', workspace: root, focusFile: 'greet.js', expectedHash: createHash('sha256').update(source).digest('hex'), webSearch: false, settings: connection,
  prompt: 'Sözleşme: greet(name) yalnızca string alır; null/undefined desteği bu görev kapsamında değildir. Yalnızca greet.js içindeki greet(name) fonksiyonunda ismi name.trim() ile temizle. Beklenen: greet(" Ada ") === "Merhaba Ada!" ve greet("") === "Merhaba !". Küçük bir dosya önerisi oluştur ve denetle. Yeni dosya ekleme, kısa rapor ver.' });
console.log('Started isolated team job:', run.id);
const started = Date.now(); let result;
try {
  while (Date.now() - started < 245000) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    result = (await get('/api/office')).runs.find(r => r.id === run.id);
    if (!['running', 'planning'].includes(result.status)) break;
  }
  if (['running', 'planning'].includes(result?.status)) await post({ action: 'cancel', id: run.id });
  assert.equal(result?.status, 'completed', result?.error || 'Team timeout');
  assert.equal(await fs.readFile(root + '/greet.js', 'utf8'), source, 'Proposal must not overwrite the file automatically');
  const artifact = result.artifacts.find(a => a.path === 'greet.js');
  assert.equal(artifact?.review?.verdict, 'approved', 'Final review must approve this exact proposal');
  await post({ action: 'apply', id: run.id, artifactId: artifact.id });
  const { greet } = await import('file://' + root + '/greet.js');
  assert.equal(greet(' Ada '), 'Merhaba Ada!');
  console.log(`PASS real team plan → reviewed code → explicit apply → execute (${Date.now() - started}ms, ${result.calls} model steps)`);
  await post({ action: 'delete', id: run.id });
  await fs.rm(root, { recursive: true, force: true });
} catch (error) {
  console.error('Fixture retained for diagnosis:', root);
  throw error;
}
