// Integration tests against the running local Chloe server. Uses synthetic keys.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
let count = 0;
const check = (label, condition) => { assert.ok(condition, label); console.log('PASS', label); count++; };
async function api(body) {
  const response = await fetch(base + '/api/office', body ? { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body), signal: AbortSignal.timeout(35000) } : {});
  return { status: response.status, ...await response.json() };
}
const original = await api();
assert.equal(original.status, 200);
assert.ok(!original.agents.some((a) => a.hasKey), 'Do not replace an existing team with saved keys. Use an isolated test server.');
assert.ok(!original.runs.some((r) => ['planning', 'running'].includes(r.status)), 'A user job is running.');
const keysSeen = new Set();
let behavior = 'normal';
let toolRequests = 0;
const server = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); const key = request.headers.authorization;
  if (body.tools?.length) toolRequests++;
  keysSeen.add(key);
  const prompt = body.messages.filter((m) => m.role === 'user').at(-1)?.content || '';
  let content = 'Görev tamamlandı. QA denetimi geçti.'; let toolCalls;
  if (prompt.includes('Yalnızca JSON')) {
    if (behavior === 'cancel') await new Promise((resolve) => setTimeout(resolve, 5000));
    content = behavior === 'invalid' ? 'not a plan' : JSON.stringify({ tasks: [
      { id: 't1', agentId: 'qa-worker', title: 'İnceleme', instructions: 'QA incelemesi', dependsOn: [] },
      { id: 't2', agentId: 'qa-worker', title: 'Denetim', instructions: 'QA denetimi', dependsOn: ['t1'] },
    ] });
  } else if (behavior === 'file' && prompt.includes('Görevin: QA incelemesi')) {
    const previous = body.messages.filter((m) => m.role === 'tool');
    if (previous.length === 0) toolCalls = [{ id: 'qa-read', type: 'function', function: { name: 'readFile', arguments: JSON.stringify({ path: 'note.txt' }) } }];
    if (previous.length === 1) toolCalls = [{ id: 'qa-propose', type: 'function', function: { name: 'proposeFile', arguments: JSON.stringify({ path: 'note.txt', content: 'QA changed content' }) } }];
  } else if (behavior === 'unsafe' && prompt.includes('Görevin: QA incelemesi') && !body.messages.some((m) => m.role === 'tool')) {
    toolCalls = [{ id: 'qa-escape', type: 'function', function: { name: 'readFile', arguments: JSON.stringify({ path: '../outside.txt' }) } }];
  }
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ id: 'qa', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: toolCalls ? null : content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
const agents = ['coordinator', 'worker'].map((name) => ({ id: 'qa-' + name, name: 'QA ' + name, role: name === 'coordinator' ? 'coordinator' : 'reviewer', provider: 'custom', model: 'qa', baseUrl: endpoint, apiKey: 'qa-' + name + '-only', instructions: '', enabled: true }));
const ids = []; const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'chloe-office-qa-'));
await fs.writeFile(path.join(folder, 'note.txt'), 'QA original');
async function start(mode = 'normal', workspace = '') {
  behavior = mode;
  const result = await api({ action: 'start', prompt: 'QA synthetic validation ' + mode, workspace, webSearch: false });
  assert.equal(result.status, 202, JSON.stringify(result)); ids.push(result.run.id); return result.run.id;
}
async function settled(id) {
  for (let i = 0; i < 120; i++) {
    const run = (await api()).runs.find((r) => r.id === id);
    if (!['planning', 'running'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Test run did not finish');
}
try {
  check('invalid team rejected', (await api({ action: 'saveAgents', agents: [] })).status === 400);
  const saved = await api({ action: 'saveAgents', agents });
  check('separate agent settings saved', saved.status === 200);
  check('keys absent from API responses', !JSON.stringify(await api()).includes('qa-coordinator-only') && saved.agents.every((a) => a.hasKey && !a.apiKey));
  const store = await fs.readFile('data/office/office.json', 'utf8');
  check('keys encrypted on disk', !store.includes('qa-coordinator-only') && !store.includes('qa-worker-only'));
  const changedProvider = await api({ action: 'saveAgents', agents: saved.agents.map((a) => a.id === 'qa-worker' ? { ...a, provider: 'anthropic', model: 'claude-test', baseUrl: '' } : a) });
  check('agent provider switch cannot reuse old key', changedProvider.status === 200 && !changedProvider.agents.find((a) => a.id === 'qa-worker').hasKey);
  await api({ action: 'saveAgents', agents });
  const changedEndpoint = await api({ action: 'saveAgents', agents: saved.agents.map((a) => a.id === 'qa-worker' ? { ...a, baseUrl: 'http://127.0.0.1:1/v1' } : a) });
  check('agent endpoint switch cannot leak old key', changedEndpoint.status === 200 && !changedEndpoint.agents.find((a) => a.id === 'qa-worker').hasKey);
  await api({ action: 'saveAgents', agents });
  check('agent connection test', (await api({ action: 'testAgent', id: 'qa-worker' })).status === 200);
  const completed = await settled(await start());
  check('plan, dependent workers and synthesis complete', completed.status === 'completed' && completed.tasks.length === 2 && completed.tasks.every((t) => t.status === 'completed') && !!completed.result);
  check('separate agent keys reach intended provider', keysSeen.has('Bearer qa-coordinator-only') && keysSeen.has('Bearer qa-worker-only'));
  check('usage and events persisted', completed.calls === 4 && completed.tokens > 0 && completed.events.length >= 6);
  await api({ action: 'saveAgents', agents: agents.map((a) => ({ ...a, supportsTools: false })) });
  const beforeTextOnly = toolRequests;
  const textOnly = await settled(await start('normal', folder));
  check('text-only custom models work without unsupported tools', textOnly.status === 'completed' && toolRequests === beforeTextOnly);
  await api({ action: 'saveAgents', agents });
  const cancelId = await start('cancel');
  check('concurrent run rejected', (await api({ action: 'start', prompt: 'QA duplicate', workspace: '' })).status === 400);
  await api({ action: 'cancel', id: cancelId });
  check('background work cancelled', (await settled(cancelId)).status === 'cancelled');
  const invalid = await settled(await start('invalid'));
  check('invalid model plan fails visibly', invalid.status === 'failed' && !!invalid.error);
  const fileRun = await settled(await start('file', folder));
  check('file tool produces proposal', fileRun.status === 'completed' && fileRun.artifacts.length === 1);
  check('no automatic file overwrite', await fs.readFile(path.join(folder, 'note.txt'), 'utf8') === 'QA original');
  const artifact = fileRun.artifacts[0];
  await fs.writeFile(path.join(folder, 'note.txt'), 'QA external modification');
  check('concurrent file modification protected', (await api({ action: 'apply', id: fileRun.id, artifactId: artifact.id })).status === 400);
  await fs.writeFile(path.join(folder, 'note.txt'), 'QA original');
  check('reviewed change can be applied', (await api({ action: 'apply', id: fileRun.id, artifactId: artifact.id })).status === 200 && await fs.readFile(path.join(folder, 'note.txt'), 'utf8') === 'QA changed content');
  check('original file backed up', await fs.readFile(`data/office/backups/${fileRun.id}/${artifact.id}`, 'utf8') === 'QA original');
  check('duplicate apply rejected', (await api({ action: 'apply', id: fileRun.id, artifactId: artifact.id })).status === 400);
  const foreign = await fetch(base + '/api/office', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel', id: 'none' }) });
  check('cross-origin mutation rejected', foreign.status === 403);
  const foreignBrowser = await fetch(base + '/api/browser', { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'navigate', url: 'https://example.com' }) });
  check('cross-origin browser automation rejected', foreignBrowser.status === 403);
  const malformedBrowser = await fetch(base + '/api/browser', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: '{invalid' });
  check('malformed browser request returns a client error', malformedBrowser.status === 400);
  const longSelector = await fetch(base + '/api/browser', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read_element', url: 'https://example.com', selector: 'x'.repeat(501) }) });
  check('invalid browser selector is rejected before browser launch', longSelector.status === 400);
  for (const body of [{ text: '' }, { text: 'x'.repeat(12001) }]) { const r = await fetch(base + '/api/voice', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify(body) }); check('same-origin voice accepts request and validates input', r.status === 400); }
} finally {
  for (const id of ids) { await api({ action: 'cancel', id }); await settled(id); await api({ action: 'delete', id }); }
  await api({ action: 'saveAgents', agents: original.agents });
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
  // Remove only this test's temporary files and its backup folders.
  await fs.rm(folder, { recursive: true });
  for (const id of ids) await fs.rm(path.join('data/office/backups', id), { recursive: true, force: true });
}
console.log(`TOTAL ${count} passed; test team/runs/files removed, original team restored.`);
