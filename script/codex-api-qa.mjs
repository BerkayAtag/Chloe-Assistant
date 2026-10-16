// Real HTTP lifecycle tests, isolated generated project, no user's files or keys.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';

const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'chloe-code-api-'));
const hash = (source) => createHash('sha256').update(source).digest('hex');
const headers = { 'Content-Type': 'application/json', Origin: base };
let checks = 0;
const check = (label, condition) => { assert.ok(condition, label); console.log('PASS', label); checks++; };
async function post(route, body, signal) {
  const response = await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body), signal });
  return { status: response.status, ...await response.json() };
}
let seenModel = '';
const model = http.createServer(async (req, res) => {
  let text = ''; for await (const part of req) text += part;
  const body = JSON.parse(text); seenModel = body.model;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 'qa', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: 'export const created = true;\n' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 6, total_tokens: 8 } }));
});
await new Promise((resolve) => model.listen(0, '127.0.0.1', resolve));
try {
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: {
    test: 'node -e "console.log(\'CODEX_API_OK\')"',
    'test:wait': 'node -e "process.on(\'SIGTERM\',()=>{});setInterval(()=>{},1000)"',
  } }));
  const list = await post('/api/codex/workspace', { action: 'list', workspace: root });
  check('workspace opened', list.status === 200 && list.entries.some((entry) => entry.path === 'package.json'));
  const created = await post('/api/codex/workspace', { action: 'save', workspace: root, path: 'root.txt', source: 'new', expectedHash: hash('') });
  check('root file saved on disk', created.status === 200 && await fs.readFile(path.join(root, 'root.txt'), 'utf8') === 'new');
  check('stale edit rejected', (await post('/api/codex/workspace', { action: 'save', workspace: root, path: 'root.txt', source: 'stale', expectedHash: hash('') })).status === 409);
  check('missing parent cannot create wrong target', (await post('/api/codex/workspace', { action: 'save', workspace: root, path: 'missing/new.ts', source: 'no', expectedHash: hash('') })).status === 404);
  const bad = await fetch(base + '/api/codex/workspace', { method: 'POST', headers, body: '{invalid' });
  check('malformed JSON is a client error', bad.status === 400);
  const foreign = await fetch(base + '/api/codex/workspace', { method: 'POST', headers: { ...headers, Origin: 'https://foreign.example' }, body: '{}' });
  check('foreign origin cannot access files', foreign.status === 403);
  const tasks = await post('/api/codex/command', { task: 'list', workspace: root });
  check('project tasks discovered', tasks.status === 200 && tasks.tasks.some((task) => task.id === 'test'));
  const run = await post('/api/codex/command', { task: 'test', workspace: root });
  check('actual project test executes successfully', run.success && run.output.includes('CODEX_API_OK'));
  const controller = new AbortController();
  const pending = post('/api/codex/command', { task: 'test:wait', workspace: root }, controller.signal).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 500));
  controller.abort(); await pending;
  let stopped = false;
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const next = await post('/api/codex/command', { task: 'test', workspace: root });
    if (next.success) { stopped = true; break; }
  }
  check('cancel kills command group and releases project lock', stopped);
  const ai = await post('/api/codex', { filename: 'empty.ts', source: '', instruction: 'Create an export', settings: { provider: 'cloud', cloudProvider: 'custom', apiKey: 'qa-only', apiBaseUrl: `http://127.0.0.1:${model.address().port}/v1`, customModel: 'qa-current-provider', cloudModel: 'qa-current-provider', customProviderName: 'QA', customSupportsTools: false, savedCustomProviders: [], selectedCustomProviderId: '' } });
  check('AI can create code in an empty file using selected provider', ai.status === 200 && ai.source.includes('created') && seenModel === 'qa-current-provider');
  check('OAuth setup rejects missing application header', (await post('/api/integrations/setup', { provider: 'google', clientId: 'qa', clientSecret: 'qa' })).status === 403);
  const malformedEmail = await fetch(base + '/api/integrations/connect/google?email=not-an-email', { redirect: 'manual' });
  check('OAuth rejects malformed email before contacting provider', malformedEmail.status === 400);
} finally {
  model.closeAllConnections(); await new Promise((resolve) => model.close(resolve));
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`TOTAL ${checks} passed; isolated test project removed.`);
