import test from 'node:test';
import assert from 'node:assert/strict';
import { localRequestAllowed, localRequestOrigin } from '../src/lib/request-origin.ts';
import { modelErrorMessage } from '../src/lib/model-error.ts';
import { readPublicPage } from '../src/lib/public-page.ts';
import { DEFAULT_SETTINGS, activeCustomProvider, updateProviderSettings, settingsForRequest, loadSettings, modalityStatus, hasExplicitConnection } from '../src/lib/settings.ts';
import { mediaConnection, readLimitedBytes } from '../src/lib/media-provider.ts';

const savedProfile = { id: 'test', name: 'Old API', apiKey: 'old-key', baseUrl: 'https://old.example/v1', model: 'old-model', supportsTools: false };
const chosen = { ...DEFAULT_SETTINGS, cloudProvider: 'custom', selectedCustomProviderId: 'test', savedCustomProviders: [savedProfile], apiKey: 'new-key', apiBaseUrl: 'https://new.example/v1', customModel: 'new-model', customProviderName: 'New API', customSupportsTools: true };
test('missing provider cannot activate a default connection', () => {
  for (const input of [undefined, null, {}, [], { provider: 'cloud' }, { provider: 'invalid' }, { provider: 'cloud', cloudProvider: 'invalid' }]) assert.equal(hasExplicitConnection(input), false);
  for (const input of [{ provider: 'local' }, chosen, DEFAULT_SETTINGS]) assert.equal(hasExplicitConnection(input), true);
});
test('visible key/model/address override stale saved profile', () => {
  const active = activeCustomProvider(chosen);
  assert.equal(active.apiKey, 'new-key'); assert.equal(active.model, 'new-model'); assert.equal(active.baseUrl, chosen.apiBaseUrl); assert.equal(active.supportsTools, true);
});
test('editing active profile persists new key and capabilities together', () => {
  const next = updateProviderSettings(chosen, { apiKey: 'rotated-key', customSpeechModel: 'voice-v2' });
  assert.equal(next.savedCustomProviders[0].apiKey, 'rotated-key'); assert.equal(next.savedCustomProviders[0].speechModel, 'voice-v2');
});
test('clearing active key cannot resurrect a stored credential', () => {
  const next = updateProviderSettings(chosen, { apiKey: '' });
  assert.equal(activeCustomProvider(next).apiKey, '');
  assert.throws(() => mediaConnection(next, 'speech', 'google-env-key'), /anahtarı eksik/);
});
test('changing endpoint without a new key clears the old credential', () => {
  const next = updateProviderSettings(chosen, { apiBaseUrl: 'https://another.example/v1' });
  assert.equal(next.apiKey, ''); assert.equal(next.savedCustomProviders[0].apiKey, '');
  assert.equal(updateProviderSettings(chosen, { apiBaseUrl: 'https://another.example/v1', apiKey: 'new-service-key' }).apiKey, 'new-service-key');
});
test('provider switch isolates and restores each built-in key and model', () => {
  const google = { ...DEFAULT_SETTINGS, apiKey: 'google-key', cloudModel: 'google-model' };
  const other = updateProviderSettings(google, { cloudProvider: 'anthropic' });
  assert.equal(other.apiKey, ''); assert.ok(other.cloudModel.startsWith('claude-'));
  const back = updateProviderSettings({ ...other, apiKey: 'anthropic-key', cloudModel: 'claude-own' }, { cloudProvider: 'gemini' });
  assert.equal(back.apiKey, 'google-key'); assert.equal(back.cloudModel, 'google-model');
  assert.equal(back.builtinConnections.anthropic.apiKey, 'anthropic-key');
});
test('custom profile restored after leaving built-in provider without mixing keys', () => {
  const saved = updateProviderSettings(chosen, { apiKey: 'rotated-key' });
  const google = updateProviderSettings(saved, { cloudProvider: 'gemini' });
  assert.equal(google.apiKey, '');
  const back = updateProviderSettings(google, { cloudProvider: 'custom' });
  assert.equal(back.apiKey, 'rotated-key'); assert.equal(back.customModel, 'new-model');
});
test('request payload contains only the active credential', () => {
  const payload = settingsForRequest({ ...chosen, builtinConnections: { gemini: { apiKey: 'hidden-key', model: 'g' } }, jarvisSpeechApiKey: 'speech-key' });
  assert.equal(payload.apiKey, 'new-key'); assert.equal(payload.selectedCustomProviderId, '');
  assert.deepEqual(payload.savedCustomProviders, []); assert.deepEqual(payload.builtinConnections, {});
  // Ses için AYRI anahtar /api/voice tarafından kullanıldığı için payload'da kalır;
  // diğer kayıtlı anahtarlar (kasa profilleri) istemciye gönderilmez.
  assert.equal(payload.jarvisSpeechApiKey, 'speech-key');
  assert.deepEqual(payload.savedApiKeys, []);
  assert.equal(settingsForRequest({ ...chosen, provider: 'local' }).apiKey, '');
});
test('local choice survives reload even when matching old default', () => {
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ ...DEFAULT_SETTINGS, provider: 'local' }) } };
  try { assert.equal(loadSettings().provider, 'local'); } finally { delete globalThis.window; }
});
test('Jarvis silence tolerance restores only supported values and defaults invalid values', () => {
  for (const milliseconds of [900, 1200, 1500, 2000, 2500, 3000, 3500]) {
    globalThis.window = { localStorage: { getItem: () => JSON.stringify({ jarvisSilenceMs: milliseconds }) } };
    try { assert.equal(loadSettings().jarvisSilenceMs, milliseconds); } finally { delete globalThis.window; }
  }
  for (const jarvisSilenceMs of [0, 9000, '2500', null]) {
    globalThis.window = { localStorage: { getItem: () => JSON.stringify({ jarvisSilenceMs }) } };
    try { assert.equal(loadSettings().jarvisSilenceMs, DEFAULT_SETTINGS.jarvisSilenceMs); } finally { delete globalThis.window; }
  }
});
test('legacy Gemini speech migrates to main API without losing identity or credentials', () => {
  globalThis.window = { localStorage: { getItem: () => JSON.stringify({ ...chosen, jarvisSpeechEngine: 'gemini', assistantName: 'Nova', userName: 'Berkay' }) } };
  try { const s = loadSettings(); assert.equal(s.jarvisSpeechEngine, 'main'); assert.equal(s.apiKey, 'new-key'); assert.equal(s.assistantName, 'Nova'); assert.equal(s.userName, 'Berkay'); } finally { delete globalThis.window; }
});
for (const kind of ['speech', 'image', 'video']) {
  test(`${kind} uses current custom connection; Gemini env cannot hijack it`, () => {
    const c = mediaConnection(chosen, kind, 'google-env-key');
    assert.equal(c.adapter, 'compatible'); assert.equal(c.key, 'new-key'); assert.equal(c.baseUrl, chosen.apiBaseUrl);
  });
  test(`${kind} rejects unsupported main provider without a fallback`, () => {
    for (const s of [{ ...chosen, provider: 'local' }, { ...chosen, cloudProvider: 'anthropic' }, { ...chosen, cloudProvider: 'invalid' }]) {
      assert.throws(() => mediaConnection(s, kind, 'google-env-key'), /otomatik geçilmedi/);
      assert.equal(modalityStatus(s, kind).supported, false);
    }
  });
}
test('Gemini environment key is allowed only under explicit Gemini selection', () => {
  assert.equal(mediaConnection(DEFAULT_SETTINGS, 'speech', 'google-env-key').key, 'google-env-key');
  assert.equal(mediaConnection({ ...DEFAULT_SETTINGS, apiKey: 'new-google' }, 'speech', 'google-env-key').key, 'new-google');
});
test('media rejects credential-bearing and malformed endpoints', () => {
  for (const apiBaseUrl of ['file:///etc/passwd', 'https://name:password@example.com', 'https://example.com?key=sensitive', 'bad']) assert.throws(() => mediaConnection({ ...chosen, apiBaseUrl }, 'image'));
});
test('binary response reader enforces empty and size limits', async () => {
  await assert.rejects(readLimitedBytes(new Response(''), 10), /boş/);
  await assert.rejects(readLimitedBytes(new Response('12345678901'), 10), /boyut/);
  assert.equal(new TextDecoder().decode(await readLimitedBytes(new Response('audio'), 10)), 'audio');
});

test('Next internal localhost URL accepts exact browser Host/Origin pair', () => {
  const request = new Request('http://localhost:3004/api/voice', { headers: { host: '127.0.0.1:3004', origin: 'http://127.0.0.1:3004' } });
  assert.equal(localRequestAllowed(request), true);
  assert.equal(localRequestOrigin(request), 'http://127.0.0.1:3004');
});
test('localhost and IPv6 loopback work without widening origins', () => {
  for (const host of ['localhost:3004', '[::1]:3004']) assert.equal(localRequestAllowed(new Request('http://localhost:3004', { headers: { host, origin: 'http://' + host } })), true);
});
test('foreign origins, different ports, null origin and rebinding Host rejected', () => {
  for (const origin of ['https://external.example', 'http://127.0.0.1:4000', 'null']) assert.equal(localRequestAllowed(new Request('http://localhost:3004', { headers: { host: '127.0.0.1:3004', origin } })), false);
  assert.equal(localRequestAllowed(new Request('http://localhost:3004', { headers: { host: 'external.example' } })), false);
});
test('provider errors redact keys and explain quotas', () => {
  const error = Object.assign(new Error('request failed'), { statusCode: 429, responseBody: JSON.stringify({ error: { message: 'Rate limit exceeded: synthetic-secret' } }) });
  const message = modelErrorMessage(error, ['synthetic-secret']);
  assert.ok(message.includes('kullanım kotası doldu'));
  assert.ok(message.includes('HTTP 429'));
  assert.ok(!message.includes('synthetic-secret'));
});
test('public-page tool rejects local paths, private network and credentials', async () => {
  for (const url of ['file:///etc/passwd', 'http://example.com', 'https://user:secret@example.com', 'https://example.com:8443', 'https://127.0.0.1', 'https://10.0.0.1', 'https://169.254.169.254']) await assert.rejects(() => readPublicPage(url));
});
test('public-page tool reads real HTTPS content', async () => {
  const text = await readPublicPage('https://example.com');
  assert.match(text, /Example Domain/);
  assert.ok(!text.includes('<html'));
});
test('public-page tool supports cancellation', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => readPublicPage('https://example.com', controller.signal));
});
