import test from 'node:test';
import assert from 'node:assert/strict';
import { providerSetup } from '../src/lib/oauth-setup.ts';

test('OAuth setup reports missing IDs, secrets, and encryption key without exposing values', () => {
  const names = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET', 'JARVIS_TOKEN_ENCRYPTION_KEY', 'JARVIS_BASE_URL'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    const google = providerSetup('google');
    assert.equal(google.configured, false);
    assert.deepEqual(google.missing, ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'JARVIS_TOKEN_ENCRYPTION_KEY']);
    assert.equal(google.clientId, undefined);
    assert.equal(google.clientSecret, undefined);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
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
