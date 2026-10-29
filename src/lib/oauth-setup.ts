import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { dataDirectory } from './data-dir';

export type IntegrationProvider = 'google' | 'microsoft';

function directory() {
  return process.env.CHLOE_OAUTH_DIR || path.join(homedir(), process.platform === 'darwin' ? 'Library/Application Support/Chloe/oauth' : '.chloe/oauth');
}

function localKey() {
  const folder = directory();
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, 'master.key');
  if (!existsSync(file)) {
    if (existsSync(path.join(folder, 'clients.enc')) || existsSync(path.join(folder, 'tokens.json'))) throw new Error('OAuth kasa anahtarı kayıp. Mevcut kayıtlar korunuyor.');
    try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (!existsSync(file)) throw error; }
  }
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error('OAuth kasa anahtarı geçersiz.');
  return key;
}

export function oauthTokenFile() { return path.join(directory(), 'tokens.json'); }

export function oauthTokenKey() {
  const encoded = process.env.JARVIS_TOKEN_ENCRYPTION_KEY;
  if (encoded) {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || Buffer.from(encoded, 'base64').length !== 32) throw new Error('JARVIS_TOKEN_ENCRYPTION_KEY (32 bayt Base64 anahtar gerekli)');
    return Buffer.from(encoded, 'base64');
  }
  const legacy = dataDirectory('jarvis-integrations.json');
  if (!existsSync(oauthTokenFile()) && existsSync(legacy) && Object.keys(JSON.parse(readFileSync(legacy, 'utf8'))).length) {
    throw new Error('Eski bağlı hesapları korumak için JARVIS_TOKEN_ENCRYPTION_KEY yeniden tanımlanmalı.');
  }
  return localKey();
}

function readClients(): Partial<Record<IntegrationProvider, { clientId: string; clientSecret: string }>> {
  const file = path.join(directory(), 'clients.enc');
  if (!existsSync(file)) return {};
  const value = readFileSync(file);
  const decipher = createDecipheriv('aes-256-gcm', localKey(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(12, -16)), decipher.final()]).toString('utf8'));
}

export function saveOAuthClient(provider: IntegrationProvider, clientId: string, clientSecret: string) {
  if (!clientId.trim() || !clientSecret.trim() || clientId.length > 1024 || clientSecret.length > 4096) throw new Error('OAuth istemci kimliği ve istemci sırrı gerekli. AI API anahtarı burada kullanılamaz.');
  const clients = readClients();
  clients[provider] = { clientId: clientId.trim(), clientSecret: clientSecret.trim() };
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', localKey(), iv);
  const encrypted = Buffer.concat([iv, cipher.update(JSON.stringify(clients)), cipher.final(), cipher.getAuthTag()]);
  const file = path.join(directory(), 'clients.enc');
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
  renameSync(temporary, file);
}

export function providerSetup(provider: IntegrationProvider) {
  const saved = readClients()[provider];
  const clientId = saved?.clientId || process.env[provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID'];
  const clientSecret = saved?.clientSecret || process.env[provider === 'google' ? 'GOOGLE_CLIENT_SECRET' : 'MICROSOFT_CLIENT_SECRET'];
  let keyError = '';
  try { oauthTokenKey(); } catch (error) { keyError = error instanceof Error ? error.message : 'OAuth kasası açılamadı.'; }
  let invalidBaseUrl = false;
  if (process.env.JARVIS_BASE_URL) {
    try {
      const url = new URL(process.env.JARVIS_BASE_URL);
      const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
      invalidBaseUrl = (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
        !!url.username || !!url.password || !!url.search || !!url.hash;
    } catch { invalidBaseUrl = true; }
  }
  const missing = [
    !clientId && (provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID'),
    !clientSecret && (provider === 'google' ? 'GOOGLE_CLIENT_SECRET' : 'MICROSOFT_CLIENT_SECRET'),
    keyError,
    invalidBaseUrl && 'JARVIS_BASE_URL (HTTPS veya localhost adresi gerekli)',
  ].filter(Boolean);
  return {
    configured: missing.length === 0,
    missing: missing as string[],
    clientId,
    clientSecret,
  };
}
