import test, { after } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { providerSetup, saveOAuthClient, oauthTokenKey } from '../src/lib/oauth-setup.ts';
import { emailProvider, normalizeEmail } from '../src/lib/email-provider.ts';
const originalDir = process.env.CHLOE_OAUTH_DIR;
const testDir = mkdtempSync(path.join(os.tmpdir(), 'chloe-oauth-'));
process.env.CHLOE_OAUTH_DIR = testDir;
after(() => { if (originalDir) process.env.CHLOE_OAUTH_DIR = originalDir; else delete process.env.CHLOE_OAUTH_DIR; rmSync(testDir, { recursive: true, force: true }); });

test('OAuth setup reports missing clients and provisions encryption automatically', () => {
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'JARVIS_TOKEN_ENCRYPTION_KEY', 'JARVIS_BASE_URL'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const google = providerSetup('google');
    assert.equal(google.configured, false);
    assert.deepEqual(google.missing, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']);
    assert.equal(google.clientId, undefined);
    assert.equal(google.clientSecret, undefined);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('email detection distinguishes public providers and unknown company domains', () => {
  assert.equal(normalizeEmail(' Name@GMAIL.com '), 'name@gmail.com');
  assert.equal(emailProvider('name@gmail.com'), 'google');
  assert.equal(emailProvider('name@outlook.com'), 'microsoft');
  assert.equal(emailProvider('name@company.com'), '');
  assert.throws(() => normalizeEmail('not-an-address'));
  assert.throws(() => normalizeEmail('user@gmail.com\nInjected'));
});

test('one-time clients persist encrypted without restart or changing the token key', () => {
  const key = oauthTokenKey();
  saveOAuthClient('google', 'qa-client-id', 'qa-client-secret');
  assert.equal(providerSetup('google').clientId, 'qa-client-id');
  assert.equal(providerSetup('google').configured, true);
  assert.ok(!readFileSync(path.join(testDir, 'clients.enc')).includes(Buffer.from('qa-client-secret')));
  saveOAuthClient('microsoft', 'qa-microsoft-id', 'qa-microsoft-secret');
  assert.equal(providerSetup('google').clientId, 'qa-client-id');
  assert.deepEqual(oauthTokenKey(), key);
});

test('OAuth setup rejects an invalid encryption key and base URL before reporting ready', () => {
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'JARVIS_TOKEN_ENCRYPTION_KEY', 'JARVIS_BASE_URL'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    process.env.GOOGLE_CLIENT_ID = 'configured';
    process.env.GOOGLE_CLIENT_SECRET = 'configured';
    process.env.JARVIS_TOKEN_ENCRYPTION_KEY = 'not-a-valid-key';
    process.env.JARVIS_BASE_URL = 'https://user:password@example.com';
    const setup = providerSetup('google');
    assert.equal(setup.configured, false);
    assert.deepEqual(setup.missing, [
      'JARVIS_TOKEN_ENCRYPTION_KEY (32 bayt Base64 anahtar gerekli)',
      'JARVIS_BASE_URL (HTTPS veya localhost adresi gerekli)',
    ]);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
