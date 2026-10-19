import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ConnectionSettings, SavedApiKey } from './settings';
import { isolateJarvisConnections } from './settings.ts';

type Vault = { version: 1; revision: number; connection: Partial<ConnectionSettings> };
const fields = new Set(['provider', 'cloudProvider', 'cloudModel', 'apiKey', 'builtinConnections', 'apiBaseUrl',
  'customProviderName', 'customModel', 'customSupportsTools', 'customImageModel', 'customVideoModel',
  'customSpeechModel', 'customSpeechVoice', 'savedCustomProviders', 'selectedCustomProviderId',
  'savedApiKeys', 'ollamaUrl', 'ollamaModel',
  'jarvisProvider', 'jarvisApiKey', 'jarvisModel', 'jarvisApiBaseUrl',
  'jarvisSpeechProvider', 'jarvisSpeechApiKey', 'jarvisSpeechModel', 'jarvisSpeechApiBaseUrl']);
const providers = ['gemini', 'openai', 'anthropic', 'custom'];
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const string = (x: unknown, max = 4096) => typeof x === 'string' && x.length <= max;

export function connectionDirectory() {
  return process.env.CHLOE_CONNECTION_DIR || path.join(homedir(), process.platform === 'darwin'
    ? 'Library/Application Support/Chloe/connections' : '.chloe/connections');
}

export function validateConnection(input: unknown): Partial<ConnectionSettings> {
  if (!record(input) || JSON.stringify(input).length > 256_000) throw new Error('Bağlantı kaydı geçersiz veya çok büyük.');
  const clean: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(input)) {
    if (!fields.has(name)) continue;
    if (name === 'provider') { if (!['cloud', 'local'].includes(value as string)) throw new Error('Model kaynağı geçersiz.'); }
    else if (name === 'cloudProvider') { if (!providers.includes(value as string)) throw new Error('Sağlayıcı geçersiz.'); }
    else if (name === 'jarvisProvider') {
      if (!['inherit', 'gemini', 'openai', 'anthropic', 'custom', 'local'].includes(value as string)) throw new Error('Jarvis sağlayıcısı geçersiz.');
    }
    else if (name === 'jarvisSpeechProvider') {
      if (!['inherit', 'gemini', 'custom'].includes(value as string)) throw new Error('Ses sağlayıcısı geçersiz.');
    }
    else if (name === 'customSupportsTools') { if (typeof value !== 'boolean') throw new Error('Araç desteği geçersiz.'); }
    else if (name === 'builtinConnections') {
      if (!record(value) || Object.entries(value).some(([p, v]) => !providers.slice(0, 3).includes(p) || !record(v) || !string(v.apiKey) || !string(v.model, 200))) throw new Error('Kayıtlı sağlayıcı geçersiz.');
    } else if (name === 'savedCustomProviders') {
      if (!Array.isArray(value) || value.length > 100 || value.some((v) => !record(v) ||
        !['id', 'name', 'baseUrl', 'apiKey', 'model'].every((f) => string(v[f])) || typeof v.supportsTools !== 'boolean')) throw new Error('Özel bağlantı listesi geçersiz.');
    } else if (name === 'savedApiKeys') {
      if (!Array.isArray(value) || value.length > 200 || value.some((v) => !record(v) ||
        !['id', 'name', 'baseUrl', 'apiKey'].every((f) => string(v[f])) || !providers.includes(v.provider as string) || typeof v.isDefault !== 'boolean')) throw new Error('Anahtar listesi geçersiz.');
    } else if (!string(value)) throw new Error('Bağlantı alanı geçersiz.');
    clean[name] = value;
  }
  return clean as Partial<ConnectionSettings>;
}

function masterKey(directory: string) {
  const file = path.join(directory, 'master.key');
  if (!existsSync(file)) {
    if (existsSync(path.join(directory, 'vault.enc')) || existsSync(path.join(directory, 'vault.enc.bak'))) {
      throw new Error('Kasa şifreleme anahtarı bulunamadı. Eski kasa korunuyor; connections klasörünü yedeğinden geri yükle.');
    }
    try { writeFileSync(file, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (!existsSync(file)) throw error; }
  }
  const key = readFileSync(file);
  if (key.length !== 32) throw new Error('Kasa anahtarı okunamıyor; kayıtlar sıfırlanmadı.');
  chmodSync(file, 0o600);
  return key;
}

function decrypt(file: string, key: Buffer): Vault {
  const bytes = readFileSync(file);
  if (bytes.length < 29) throw new Error('Kasa dosyası eksik.');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12), { authTagLength: 16 });
  decipher.setAuthTag(bytes.subarray(-16));
  const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString('utf8'));
  if (value.version !== 1 || !Number.isSafeInteger(value.revision)) throw new Error('Kasa biçimi geçersiz.');
  return { ...value, connection: validateConnection(value.connection) };
}

export function readConnections(): Vault & { recovered: boolean } {
  const directory = connectionDirectory();
  mkdirSync(directory, { recursive: true, mode: 0o700 }); chmodSync(directory, 0o700);
  const file = path.join(directory, 'vault.enc');
  const key = masterKey(directory);
  if (!existsSync(file) && !existsSync(file + '.bak')) return { version: 1, revision: 0, connection: {}, recovered: false };
  try { return { ...decrypt(file, key), recovered: false }; }
  catch {
    try { return { ...decrypt(file + '.bak', key), recovered: true }; }
    catch { throw new Error('Bağlantı kasası veya yedeği okunamıyor. Kayıtlar korunuyor; boş ayarlarla üzerine yazılmadı.'); }
  }
}

function sameScope(a: SavedApiKey, b: SavedApiKey) {
  return a.provider === b.provider && (a.provider !== 'custom' || a.baseUrl.replace(/\/+$/, '') === b.baseUrl.replace(/\/+$/, ''));
}

/** Additive migration: a stale browser can add keys, never erase another client's keys. */
export function collectKeys(connection: Partial<ConnectionSettings>, existing: SavedApiKey[] = []) {
  const keys = existing.map((k) => ({ ...k }));
  const add = (provider: SavedApiKey['provider'], apiKey = '', baseUrl = '', name = '') => {
    if (!apiKey.trim()) return;
    const candidate = { provider, apiKey: apiKey.trim(), baseUrl };
    if (keys.some((k) => sameScope(k, candidate as SavedApiKey) && k.apiKey === candidate.apiKey)) return;
    const siblings = keys.filter((k) => sameScope(k, candidate as SavedApiKey));
    keys.push({ ...candidate, id: randomUUID(), name: name || `${provider === 'gemini' ? 'Google' : provider} · ${siblings.length + 1}. anahtar`, isDefault: !siblings.length });
  };
  for (const k of connection.savedApiKeys || []) {
    const found = keys.find((old) => old.id === k.id || sameScope(old, k) && old.apiKey === k.apiKey);
    if (!found) keys.push({ ...k, isDefault: k.isDefault && !keys.some((old) => sameScope(old, k) && old.isDefault) });
  }
  for (const [provider, c] of Object.entries(connection.builtinConnections || {})) add(provider as SavedApiKey['provider'], c.apiKey);
  for (const p of connection.savedCustomProviders || []) add('custom', p.apiKey, p.baseUrl, `${p.name} · 1. anahtar`);
  if (connection.cloudProvider) add(connection.cloudProvider, connection.apiKey, connection.cloudProvider === 'custom' ? connection.apiBaseUrl : '');
  if (connection.jarvisApiKey && connection.jarvisProvider && ['gemini', 'openai', 'anthropic', 'custom'].includes(connection.jarvisProvider)) {
    add(connection.jarvisProvider as SavedApiKey['provider'], connection.jarvisApiKey, connection.jarvisProvider === 'custom' ? (connection.jarvisApiBaseUrl || connection.apiBaseUrl || '') : '', `Jarvis · ${connection.jarvisProvider}`);
  }
  if (connection.jarvisSpeechApiKey && connection.jarvisSpeechProvider && ['gemini', 'custom'].includes(connection.jarvisSpeechProvider)) {
    add(connection.jarvisSpeechProvider as SavedApiKey['provider'], connection.jarvisSpeechApiKey, connection.jarvisSpeechProvider === 'custom' ? (connection.jarvisSpeechApiBaseUrl || '') : '', `Jarvis Ses · ${connection.jarvisSpeechProvider}`);
  }
  return keys;
}

export function writeConnections(patch: unknown, options: { migration?: boolean; revision?: number } = {}) {
  const clean = validateConnection(patch);
  const directory = connectionDirectory(); mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'write.lock');
  let fd: number;
  try { fd = openSync(lock, 'wx', 0o600); }
  catch {
    // A crashed process must not permanently lock every subsequent launch.
    const pid = Number(existsSync(lock) ? readFileSync(lock, 'utf8') : '');
    let abandoned = false;
    if (Number.isSafeInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); } catch (error) { abandoned = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
    }
    if (!abandoned) throw new Error('Kasa başka bir işlem tarafından kaydediliyor; yeniden dene.');
    unlinkSync(lock); fd = openSync(lock, 'wx', 0o600);
  }
  writeFileSync(fd, String(process.pid));
  try {
    const previous = readConnections();
    if (options.revision !== undefined && options.revision !== previous.revision) throw new Error('CONFLICT');
    const existing = previous.connection;
    const next = options.migration && previous.revision > 0 ? { ...existing }
      : isolateJarvisConnections(existing, { ...existing, ...clean });
    if (options.migration && previous.revision > 0) {
      next.savedCustomProviders = [...(existing.savedCustomProviders || []), ...(clean.savedCustomProviders || []).filter((p) =>
        !(existing.savedCustomProviders || []).some((old) => old.id === p.id || old.baseUrl === p.baseUrl))];
      next.builtinConnections = { ...clean.builtinConnections, ...existing.builtinConnections };
    }
    // Preserve previous active keys even when a field is cleared or a profile removed.
    let keys = collectKeys(existing, existing.savedApiKeys);
    if (options.migration) keys = collectKeys(clean, keys);
    else {
      for (const incoming of clean.savedApiKeys || []) {
        if (!incoming.apiKey.trim()) continue;
        const old = keys.find((k) => k.id === incoming.id);
        if (incoming.isDefault) keys = keys.map((k) => sameScope(k, incoming) ? { ...k, isDefault: false } : k);
        // Rotating a named key archives the old value under a new identity.
        if (old && old.apiKey !== incoming.apiKey) keys.push({ ...old, id: randomUUID(), isDefault: false, name: old.name + ' (önceki)' });
        keys = keys.filter((k) => k.id !== incoming.id); keys.push(incoming);
      }
    }
    keys = collectKeys(next, keys);
    if (keys.length > 200) throw new Error('Kasa 200 anahtar sınırına ulaştı. Mevcut kayıtlar silinmedi.');
    next.savedApiKeys = keys;
    if (!previous.recovered && previous.revision > 0 && JSON.stringify(existing) === JSON.stringify(next)) return previous;
    const vault: Vault = { version: 1, revision: previous.revision + 1, connection: next };
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', masterKey(directory), iv);
    const encoded = Buffer.concat([iv, cipher.update(JSON.stringify(vault), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    const file = path.join(directory, 'vault.enc'); const temporary = file + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, encoded, { mode: 0o600, flag: 'wx' });
    const written = openSync(temporary, 'r'); try { fsyncSync(written); } finally { closeSync(written); }
    try {
      if (existsSync(file) && !previous.recovered) copyFileSync(file, file + '.bak');
      renameSync(temporary, file); chmodSync(file, 0o600);
      // Backup tracks the acknowledged version, not an older key selection.
      copyFileSync(file, file + '.bak.tmp'); renameSync(file + '.bak.tmp', file + '.bak');
      chmodSync(file + '.bak', 0o600);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    return { ...vault, recovered: previous.recovered };
  } finally { closeSync(fd); unlinkSync(lock); }
}
