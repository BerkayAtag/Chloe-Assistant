import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import ts from 'typescript';
import * as settingsModule from '../src/lib/settings.ts';

function client({ legacy = {}, saved = {}, fail = false } = {}) {
  let local = JSON.stringify({ ...settingsModule.DEFAULT_SETTINGS, ...legacy });
  let connection = saved; let revision = 1; let fails = fail; let subscribed = false;
  const requests = []; const events = {}; let getState;
  const window = { localStorage: { getItem: () => local, setItem: (_k, v) => { local = v; } }, addEventListener: (n, f) => { events[n] = f; } };
  const exports = {};
  const context = vm.createContext({ exports, setTimeout, clearTimeout, AbortSignal, window,
    require: (name) => name === 'react' ? { useCallback: (fn) => fn, useSyncExternalStore: (subscribe, get) => {
      if (!subscribed) { subscribed = true; subscribe(() => {}); } getState = get; return get();
    } } : { ...settingsModule, loadSettings: () => ({ ...settingsModule.DEFAULT_SETTINGS, ...JSON.parse(local) }), saveSettings: (settings, acknowledged) => {
      local = JSON.stringify(acknowledged ? { ...settings, apiKey: '', savedApiKeys: [], builtinConnections: {}, savedCustomProviders: settings.savedCustomProviders.map((p) => ({ ...p, apiKey: '' })) } : settings);
    } },
    fetch: async (_url, options = {}) => {
      const body = options.body ? JSON.parse(options.body) : null; if (body) requests.push(body);
      if (fails) return { ok: false, json: async () => ({ error: 'synthetic disk unavailable' }) };
      if (body?.action === 'save') { connection = { ...connection, ...body.patch }; revision++; }
      return { ok: true, json: async () => ({ revision, connection, recovered: false }) };
    },
  });
  const source = ts.transpileModule(fs.readFileSync('src/hooks/useSettings.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInContext(source, context); exports.useSettings();
  return { api: exports, state: () => getState(), local: () => local, requests, fail: (v) => { fails = v; }, events };
}
async function settled() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
test('server credentials win over empty/stale browser values while local theme survives', async () => {
  const c = client({ legacy: { theme: 'black', apiKey: '' }, saved: { apiKey: 'server-secret', cloudProvider: 'custom', customModel: 'auto' } });
  await settled(); assert.equal(c.state().settings.apiKey, 'server-secret'); assert.equal(c.state().settings.theme, 'black'); assert.equal(c.state().ready, true); assert.ok(!c.local().includes('server-secret'));
});
test('identity arriving during hydration cannot reset connection', async () => {
  const c = client({ saved: { apiKey: 'server-secret' } }); c.api.useSettings()[1]((s) => ({ ...s, assistantName: 'Test Nova' }));
  await settled(); assert.equal(c.state().settings.apiKey, 'server-secret'); assert.equal(c.state().settings.assistantName, 'Test Nova');
});
test('explicit save waits for acknowledgement and coalesces connection edits', async () => {
  const c = client({ saved: { apiKey: 'old' } }); await settled(); const update = c.api.useSettings()[1];
  update((s) => ({ ...s, apiKey: 'new' })); update((s) => ({ ...s, cloudModel: 'new-model' }));
  assert.equal(await c.api.flushSettings(), true); const writes = c.requests.filter((r) => r.action === 'save');
  assert.equal(writes.length, 1); assert.equal(writes[0].patch.apiKey, 'new'); assert.equal(writes[0].patch.cloudModel, 'new-model'); assert.equal(c.state().storage.state, 'saved');
});
test('failed bootstrap retains legacy key and exposes an error instead of a success badge', async () => {
  const c = client({ legacy: { apiKey: 'legacy-secret' }, fail: true }); await settled();
  assert.equal(c.state().ready, true); assert.equal(c.state().storage.state, 'error'); assert.ok(c.local().includes('legacy-secret'));
});
test('failed write preserves pending changes and retry saves them', async () => {
  const c = client({ saved: { apiKey: 'old' } }); await settled(); c.fail(true);
  c.api.useSettings()[1]((s) => ({ ...s, apiKey: 'new' })); assert.equal(await c.api.flushSettings(), false);
  assert.equal(c.state().storage.state, 'error'); assert.equal(c.state().settings.apiKey, 'new');
  c.fail(false); await c.api.retrySettings(); assert.equal(c.state().storage.state, 'saved'); assert.equal(c.state().settings.apiKey, 'new');
});
test('preference-only changes do not rewrite shared credentials', async () => {
  const c = client({ saved: { apiKey: 'server-secret' } }); await settled();
  c.api.useSettings()[1]((s) => ({ ...s, theme: 'light' })); await c.api.flushSettings();
  assert.equal(c.requests.filter((r) => r.action === 'save').length, 0);
});
test('closing while a credential write is pending requests normal unload protection', async () => {
  const c = client(); await settled(); c.api.useSettings()[1]((s) => ({ ...s, apiKey: 'pending' }));
  let prevented = false; c.events.beforeunload({ preventDefault: () => { prevented = true; } }); assert.equal(prevented, true); await c.api.flushSettings();
});
