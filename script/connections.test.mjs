import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readConnections, writeConnections, validateConnection } from '../src/lib/connection-store.ts';
import { DEFAULT_SETTINGS, updateProviderSettings, settingsForRequest, saveSettings } from '../src/lib/settings.ts';

const base = { provider: 'cloud', cloudProvider: 'gemini', apiKey: 'synthetic-google-first', cloudModel: 'g-test',
  builtinConnections: {}, savedCustomProviders: [], savedApiKeys: [] };
const free = { id: 'free', name: 'FreeLLMAPI', baseUrl: 'http://127.0.0.1:31415/v1', apiKey: 'synthetic-free', model: 'auto', supportsTools: true };
function isolated(run) {
  const dir = mkdtempSync(path.join(tmpdir(), 'chloe-vault-test-'));
  const old = process.env.CHLOE_CONNECTION_DIR; process.env.CHLOE_CONNECTION_DIR = dir;
  try { return run(dir); } finally { if (old === undefined) delete process.env.CHLOE_CONNECTION_DIR; else process.env.CHLOE_CONNECTION_DIR = old; rmSync(dir, { recursive: true, force: true }); }
}
test('first migration is encrypted and preserves provider, key and model', () => isolated((dir) => {
  const v = writeConnections(base, { migration: true }); assert.equal(v.connection.apiKey, base.apiKey);
  assert.equal(readConnections().connection.cloudModel, 'g-test');
  for (const name of ['vault.enc', 'vault.enc.bak']) { assert.ok(!readFileSync(path.join(dir, name)).includes(base.apiKey)); if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, name)).mode & 0o777, 0o600); }
  if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'master.key')).mode & 0o777, 0o600);
}));
test('a separate process recovers the same vault after restart', () => isolated(() => {
  writeConnections(base, { migration: true });
  const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', 'import {readConnections} from "./src/lib/connection-store.ts"; console.log(readConnections().connection.apiKey === "synthetic-google-first")'], { encoding: 'utf8', cwd: process.cwd() });
  assert.equal(child.status, 0); assert.equal(child.stdout.trim(), 'true');
}));
test('another browser migrates additively without resetting active provider or overwriting a key', () => isolated(() => {
  writeConnections(base, { migration: true });
  const v = writeConnections({ ...base, cloudProvider: 'custom', apiKey: free.apiKey, savedCustomProviders: [free], apiBaseUrl: free.baseUrl }, { migration: true });
  assert.equal(v.connection.cloudProvider, 'gemini'); assert.equal(v.connection.apiKey, base.apiKey);
  assert.equal(v.connection.savedApiKeys.length, 2); assert.equal(v.connection.savedCustomProviders[0].id, 'free');
}));
test('identical reload migrations do not churn revisions', () => isolated(() => {
  const v = writeConnections(base, { migration: true });
  assert.equal(writeConnections(base, { migration: true }).revision, v.revision);
}));
test('clearing an active field keeps its archived key without silently reactivating it', () => isolated(() => {
  const v = writeConnections(base, { migration: true }); const cleared = writeConnections({ apiKey: '' }, { revision: v.revision });
  assert.equal(cleared.connection.apiKey, ''); assert.equal(cleared.connection.savedApiKeys[0].apiKey, base.apiKey);
}));
test('rotating keys retains both old and new secrets', () => isolated(() => {
  writeConnections(base, { migration: true }); writeConnections({ apiKey: 'synthetic-new' });
  const keys = readConnections().connection.savedApiKeys; assert.equal(keys.length, 2); assert.ok(keys.some((k) => k.apiKey === base.apiKey));
}));
test('stale writes are rejected without erasing data', () => isolated(() => {
  const v = writeConnections(base, { migration: true }); writeConnections({ cloudModel: 'updated' });
  assert.throws(() => writeConnections({ apiKey: '' }, { revision: v.revision }), /CONFLICT/);
  assert.equal(readConnections().connection.apiKey, base.apiKey);
}));
test('corrupted primary vault recovers the latest acknowledged backup', () => isolated((dir) => {
  writeConnections(base, { migration: true }); writeConnections({ apiKey: 'synthetic-latest' });
  writeFileSync(path.join(dir, 'vault.enc'), 'corrupt-test');
  assert.equal(readConnections().recovered, true); assert.equal(readConnections().connection.apiKey, 'synthetic-latest');
  writeConnections({ cloudModel: 'recovered' }); assert.equal(readConnections().recovered, false);
}));
test('two corrupt files fail closed instead of replacing credentials', () => isolated((dir) => {
  writeConnections(base, { migration: true });
  for (const file of ['vault.enc', 'vault.enc.bak']) writeFileSync(path.join(dir, file), 'corrupt-test');
  assert.throws(() => writeConnections(base), /sıfırlan|korunuyor/);
  assert.equal(readFileSync(path.join(dir, 'vault.enc'), 'utf8'), 'corrupt-test');
}));
test('missing master key never creates a replacement over an existing vault', () => isolated((dir) => {
  writeConnections(base, { migration: true }); renameSync(path.join(dir, 'master.key'), path.join(dir, 'master.saved'));
  assert.throws(() => readConnections(), /şifreleme anahtarı bulunamadı/);
}));
test('default key selection is isolated by provider and custom endpoint', () => {
  const keys = [ { id: 'g', name: 'Google 1', provider: 'gemini', baseUrl: '', apiKey: 'g-default', isDefault: true },
    { id: 'f', name: 'Free 1', provider: 'custom', baseUrl: free.baseUrl, apiKey: free.apiKey, isDefault: true } ];
  const s = { ...DEFAULT_SETTINGS, cloudProvider: 'custom', savedCustomProviders: [free], selectedCustomProviderId: 'free', apiBaseUrl: free.baseUrl, apiKey: free.apiKey, savedApiKeys: keys };
  const google = updateProviderSettings(s, { cloudProvider: 'gemini' }); assert.equal(google.apiKey, 'g-default');
  assert.equal(updateProviderSettings(google, { cloudProvider: 'custom' }).apiKey, free.apiKey);
  assert.equal(updateProviderSettings(s, { apiBaseUrl: 'https://other.example/v1' }).apiKey, '');
});
test('request serialization cannot include archived credentials', () => {
  const s = settingsForRequest({ ...DEFAULT_SETTINGS, apiKey: 'active', savedApiKeys: [{ id: 'g', name: '1', provider: 'gemini', apiKey: 'archived', baseUrl: '', isDefault: true }] });
  assert.equal(s.apiKey, 'active'); assert.ok(!JSON.stringify(s).includes('archived'));
});

test('dedicated Jarvis keys and models never follow a changed provider or endpoint', () => {
  const s = { ...DEFAULT_SETTINGS, jarvisProvider: 'gemini', jarvisApiKey: 'synthetic-jarvis', jarvisModel: 'gemini-test' };
  const changed = updateProviderSettings(s, { jarvisProvider: 'custom', jarvisApiBaseUrl: 'https://b.example/v1' });
  assert.equal(changed.jarvisApiKey, ''); assert.equal(changed.jarvisModel, '');
  const custom = { ...s, jarvisProvider: 'custom', jarvisApiBaseUrl: 'https://a.example/v1' };
  assert.equal(updateProviderSettings(custom, { jarvisApiBaseUrl: 'https://b.example/v1' }).jarvisApiKey, '');
  assert.equal(updateProviderSettings(custom, { jarvisApiBaseUrl: 'https://a.example/v1/' }).jarvisApiKey, s.jarvisApiKey);
  assert.equal(updateProviderSettings(custom, { jarvisApiBaseUrl: 'https://b.example/v1', jarvisApiKey: 'new-key' }).jarvisApiKey, 'new-key');
  const inheritedBase = { ...custom, jarvisApiBaseUrl: '', apiBaseUrl: 'https://a.example/v1' };
  assert.equal(updateProviderSettings(inheritedBase, { apiBaseUrl: 'https://b.example/v1' }).jarvisApiKey, '');
  const speech = { ...s, jarvisSpeechProvider: 'custom', jarvisSpeechApiKey: 'synthetic-speech', jarvisSpeechApiBaseUrl: 'https://a.example/v1' };
  assert.equal(updateProviderSettings(speech, { jarvisSpeechApiBaseUrl: 'https://b.example/v1' }).jarvisSpeechApiKey, '');
  assert.equal(updateProviderSettings(speech, { jarvisSpeechProvider: 'gemini' }).jarvisSpeechApiKey, '');
});
test('vault rejects retained Jarvis keys at a new destination and archives the old scope', () => isolated(() => {
  writeConnections({ ...base, jarvisProvider: 'custom', jarvisApiKey: 'jarvis-old', jarvisApiBaseUrl: 'https://a.example/v1',
    jarvisSpeechProvider: 'gemini', jarvisSpeechApiKey: 'speech-old' });
  const changed = writeConnections({ jarvisApiBaseUrl: 'https://b.example/v1', jarvisApiKey: 'jarvis-old',
    jarvisSpeechProvider: 'custom', jarvisSpeechApiBaseUrl: 'https://b.example/v1', jarvisSpeechApiKey: 'speech-old' });
  assert.equal(changed.connection.jarvisApiKey, ''); assert.equal(changed.connection.jarvisSpeechApiKey, '');
  const keys = changed.connection.savedApiKeys;
  assert.ok(keys.some(k => k.apiKey === 'jarvis-old' && k.baseUrl === 'https://a.example/v1'));
  assert.ok(keys.some(k => k.apiKey === 'speech-old' && k.provider === 'gemini'));
  assert.ok(!keys.some(k => k.baseUrl === 'https://b.example/v1'));
}));
test('acknowledged migration removes plaintext secrets from browser storage', () => {
  let stored; globalThis.window = { localStorage: { setItem: (_key, value) => { stored = value; } } };
  try { saveSettings({ ...DEFAULT_SETTINGS, apiKey: 'secret-active', builtinConnections: { gemini: { apiKey: 'secret-g', model: 'g' } }, savedCustomProviders: [free] }, true);
    assert.ok(!stored.includes('secret-active')); assert.ok(!stored.includes('secret-g')); assert.ok(!stored.includes(free.apiKey));
  } finally { delete globalThis.window; }
});
test('validation rejects malformed data and discards unknown fields', () => {
  for (const input of [null, [], { apiKey: 42 }, { cloudProvider: 'invalid' }, { savedApiKeys: [{}] }, { builtinConnections: { evil: {} } }]) assert.throws(() => validateConnection(input));
  assert.deepEqual(validateConnection({ apiKey: 'valid', surprise: 'ignored' }), { apiKey: 'valid' });
});
test('adding a browser default cannot override an existing default', () => isolated(() => {
  writeConnections(base, { migration: true });
  const savedApiKeys = [{ id: 'legacy', name: 'Legacy', provider: 'gemini', baseUrl: '', apiKey: 'other-google', isDefault: true }];
  const v = writeConnections({ savedApiKeys }, { migration: true });
  assert.equal(v.connection.savedApiKeys.filter((k) => k.isDefault).length, 1);
  assert.equal(v.connection.savedApiKeys.find((k) => k.isDefault).apiKey, base.apiKey);
}));
test('a dead writer lock is recovered on next save', () => isolated((dir) => {
  writeConnections(base, { migration: true });
  const child = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  writeFileSync(path.join(dir, 'write.lock'), child.stdout.trim());
  assert.doesNotThrow(() => writeConnections({ cloudModel: 'after-crash' }));
}));
test('an active writer lock is never removed', () => isolated((dir) => {
  writeConnections(base, { migration: true }); writeFileSync(path.join(dir, 'write.lock'), String(process.pid));
  assert.throws(() => writeConnections({ apiKey: '' }), /başka bir işlem/);
  assert.equal(readConnections().connection.apiKey, base.apiKey);
}));
