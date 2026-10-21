// Integration tests against the running local Chloe server. Uses synthetic keys.
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
const officeDir = process.env.CHLOE_OFFICE_DIR || 'data/office';
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
let comparedOriginalAndProposal = false;
let redundantProposalFollowups = 0;
let repairRequests = 0;
let forcedSummaries = 0;
let artifactRepairs = 0;
const sessionHeaders = [];
const server = http.createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = JSON.parse(raw); const key = request.headers.authorization;
  sessionHeaders.push({ key, session: request.headers['x-session-id'] });
  if (body.tools?.length) toolRequests++;
  keysSeen.add(key);
  const prompt = body.messages.filter((m) => m.role === 'user').at(-1)?.content || '';
  let content = 'Görev tamamlandı. QA denetimi geçti.'; let toolCalls;
  if (prompt.includes('ARTIFACT_REVIEW_GATE')) {
    if (prompt.includes('"before":"QA original"') && prompt.includes('"proposed":"QA changed content"')) comparedOriginalAndProposal = true;
    content = JSON.stringify({ reviews: [{ path: 'note.txt', verdict: behavior === 'file-rejected' || (behavior.startsWith('file-repair') && !artifactRepairs) ? 'changes_requested' : 'approved', summary: 'QA synthetic review. Tests not executed by agent.' }] });
  } else if (prompt.includes('DENETIM_DUZELTMESI')) {
    artifactRepairs++;
    if (behavior === 'file-repair-conflict') await fs.writeFile(path.join(folder, 'note.txt'), 'QA external change during repair');
    content = JSON.stringify({ files: [{ path: 'note.txt', content: 'QA repaired content' }] });
  } else if (prompt.includes('Yalnızca JSON')) {
    if (behavior === 'repair') repairRequests++;
    if (behavior === 'cancel') await new Promise((resolve) => setTimeout(resolve, 5000));
    content = behavior === 'invalid' ? 'not a plan' : behavior === 'repair' && repairRequests === 1 ? JSON.stringify({ tasks: [{ id: 't1', agentId: 'invented-worker', title: 'Bad identity', instructions: 'Inspect', dependsOn: [] }] }) : JSON.stringify({ tasks: [
      { id: 't1', agentId: 'qa-worker', title: 'İnceleme', instructions: 'QA incelemesi', dependsOn: [] },
      { id: 't2', agentId: 'qa-worker', title: 'Denetim', instructions: 'QA denetimi', dependsOn: ['t1'] },
    ] });
  } else if (behavior === 'drain' && prompt.includes('Görevin:')) {
    if (body.tool_choice === 'none') forcedSummaries++;
    else toolCalls = [{ id: `qa-read-${body.messages.length}`, type: 'function', function: { name: 'readFile', arguments: JSON.stringify({ path: 'note.txt' }) } }];
  } else if (behavior === 'fallback' && prompt.includes('CODEX_FILE_PROPOSAL:')) {
    content = JSON.stringify({ path: 'note.txt', content: 'QA fallback code proposal' });
  } else if (behavior.startsWith('file') && prompt.includes('Görevin: QA incelemesi')) {
    const previous = body.messages.filter((m) => m.role === 'tool');
    if (previous.length >= 2) redundantProposalFollowups++;
    if (previous.length === 0) toolCalls = [{ id: 'qa-read', type: 'function', function: { name: 'readFile', arguments: JSON.stringify({ path: path.join(await fs.realpath(folder), 'note.txt') }) } }];
    if (previous.length === 1) toolCalls = [{ id: 'qa-propose', type: 'function', function: { name: 'proposeFile', arguments: JSON.stringify({ path: path.join(await fs.realpath(folder), 'note.txt'), content: 'QA changed content' }) } }];
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
  const store = await fs.readFile(path.join(officeDir, 'office.json'), 'utf8');
  check('keys encrypted on disk', !store.includes('qa-coordinator-only') && !store.includes('qa-worker-only'));
  const changedProvider = await api({ action: 'saveAgents', agents: saved.agents.map((a) => a.id === 'qa-worker' ? { ...a, provider: 'anthropic', model: 'claude-test', baseUrl: '' } : a) });
  check('agent provider switch cannot reuse old key', changedProvider.status === 200 && !changedProvider.agents.find((a) => a.id === 'qa-worker').hasKey);
  await api({ action: 'saveAgents', agents });
  const changedEndpoint = await api({ action: 'saveAgents', agents: saved.agents.map((a) => a.id === 'qa-worker' ? { ...a, baseUrl: 'http://127.0.0.1:1/v1' } : a) });
  check('agent endpoint switch cannot leak old key', changedEndpoint.status === 200 && !changedEndpoint.agents.find((a) => a.id === 'qa-worker').hasKey);
  await api({ action: 'saveAgents', agents });
  check('agent connection test', (await api({ action: 'testAgent', id: 'qa-worker' })).status === 200);
  sessionHeaders.length = 0;
  const completed = await settled(await start());
  check('plan, dependent workers and synthesis complete', completed.status === 'completed' && completed.tasks.length === 2 && completed.tasks.every((t) => t.status === 'completed') && !!completed.result);
  check('separate agent keys reach intended provider', keysSeen.has('Bearer qa-coordinator-only') && keysSeen.has('Bearer qa-worker-only'));
  check('usage and events persisted', completed.calls === 4 && completed.tokens > 0 && completed.events.length >= 6);
  check('gateway session stays stable per agent within a run', agents.every(a => {
    const values = sessionHeaders.filter(x => x.key === `Bearer ${a.apiKey}`).map(x => x.session);
    return values.length >= 2 && values.every(v => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v)) && new Set(values).size === 1;
  }));
  const drained = await settled(await start('drain', folder));
  check('tool workers reserve their final step for a visible result', drained.status === 'completed' && forcedSummaries === 2 && drained.calls === 8);
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
  repairRequests = 0;
  const repaired = await settled(await start('repair'));
  check('invalid agent identity receives one bounded plan repair', repaired.status === 'completed' && repairRequests === 2 && repaired.calls === 5);
  check('repaired plan uses only registered workers', repaired.tasks.every(t => t.agentId === 'qa-worker') && repaired.events.some(e => e.message.includes('hiçbir çalışan başlatılmadan')));
  behavior = 'file';
  const hash = createHash('sha256').update('QA original').digest('hex');
  check('Codex rejects stale editor context', (await api({ action: 'start', prompt: 'QA Codex stale', workspace: folder, focusFile: 'note.txt', expectedHash: '0'.repeat(64) })).status === 400);
  const focus = await api({ action: 'start', prompt: 'QA Codex team handoff', workspace: folder, focusFile: 'note.txt', expectedHash: hash, webSearch: false });
  if (focus.run?.id) ids.push(focus.run.id);
  check('Codex hands off the exact workspace and file', focus.status === 202 && focus.run.focusFile === 'note.txt' && focus.run.workspace === await fs.realpath(folder));
  const fileRun = await settled(focus.run.id);
  check('file tool produces proposal', fileRun.status === 'completed' && fileRun.artifacts.length === 1);
  check('focused proposal stops before redundant model follow-up', redundantProposalFollowups === 0);
  check('final review compares original and proposal and reports deterministic write state', comparedOriginalAndProposal && fileRun.result.startsWith('UYGULAMA DURUMU:'));
  check('no automatic file overwrite', await fs.readFile(path.join(folder, 'note.txt'), 'utf8') === 'QA original');
  const artifact = fileRun.artifacts[0];
  await fs.writeFile(path.join(folder, 'note.txt'), 'QA external modification');
  check('concurrent file modification protected', (await api({ action: 'apply', id: fileRun.id, artifactId: artifact.id })).status === 400);
  await fs.writeFile(path.join(folder, 'note.txt'), 'QA original');
  check('reviewed change can be applied', (await api({ action: 'apply', id: fileRun.id, artifactId: artifact.id })).status === 200 && await fs.readFile(path.join(folder, 'note.txt'), 'utf8') === 'QA changed content');
  check('original file backed up', await fs.readFile(path.join(officeDir, 'backups', fileRun.id, artifact.id), 'utf8') === 'QA original');
  check('duplicate apply rejected', (await api({ action: 'apply', id: fileRun.id, artifactId: artifact.id })).status === 400);
  const currentHash = createHash('sha256').update('QA changed content').digest('hex');
  const rejected = await settled(await start('file-rejected', folder));
  check('negative final review prevents successful completion', rejected.status === 'failed' && rejected.artifacts[0]?.review?.verdict === 'changes_requested');
  check('negative final review blocks file application', (await api({ action: 'apply', id: rejected.id, artifactId: rejected.artifacts[0].id })).status === 400);
  check('negative review stops after one repair rather than bypassing gate', artifactRepairs === 1 && rejected.tasks.some(t => t.id === 'codex-final-review-2'));
  artifactRepairs = 0;
  const repairedFile = await settled(await start('file-repair', folder));
  check('review feedback triggers one repair and a fresh approval', repairedFile.status === 'completed' && artifactRepairs === 1 && repairedFile.artifacts[0].content === 'QA repaired content' && repairedFile.artifacts[0].review.verdict === 'approved');
  check('repair never writes project without explicit apply', await fs.readFile(path.join(folder, 'note.txt'), 'utf8') === 'QA changed content');
  artifactRepairs = 0;
  const conflictingRepair = await settled(await start('file-repair-conflict', folder));
  check('repair cannot rebase over an external edit silently', conflictingRepair.status === 'failed' && conflictingRepair.error.includes('düzeltme sırasında değişti') && await fs.readFile(path.join(folder, 'note.txt'), 'utf8') === 'QA external change during repair');
  await fs.writeFile(path.join(folder, 'note.txt'), 'QA changed content');
  for (const mode of ['fallback', 'missing-proposal']) {
    behavior = mode;
    const launched = await api({ action: 'start', prompt: 'QA Codex proposal ' + mode, workspace: folder, focusFile: 'note.txt', expectedHash: currentHash, webSearch: false });
    assert.equal(launched.status, 202); ids.push(launched.run.id);
    const result = await settled(launched.run.id);
    check(mode === 'fallback' ? 'text-only Codex output becomes a reviewed file proposal' : 'missing Codex code cannot falsely report completed', mode === 'fallback'
      ? result.status === 'completed' && result.artifacts[0]?.content === 'QA fallback code proposal' && result.tasks.some((t) => t.id === 'codex-final-review')
      : result.status === 'failed' && !!result.error && result.artifacts.length === 0);
  }
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
  for (const id of ids) await fs.rm(path.join(officeDir, 'backups', id), { recursive: true, force: true });
}
console.log(`TOTAL ${count} passed; test team/runs/files removed, original team restored.`);
