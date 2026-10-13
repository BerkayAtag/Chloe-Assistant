import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { providerSetup, type IntegrationProvider } from './oauth-setup';

export { providerSetup };
export type { IntegrationProvider };
export type OAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  accountEmail: string;
  connectedAt: string;
};

type EncryptedToken = { iv: string; tag: string; data: string };
type StoredIntegration = { token: EncryptedToken };
type IntegrationStore = Partial<Record<IntegrationProvider, StoredIntegration>>;

const DATA_FILE = join(process.cwd(), 'data', 'jarvis-integrations.json');
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events',
];
const MICROSOFT_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'User.Read',
  'Mail.Read',
  'Mail.ReadWrite',
  'Mail.Send',
  'Calendars.ReadWrite',
];

function encryptionKey(): Buffer {
  const encoded = process.env.JARVIS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error('JARVIS_TOKEN_ENCRYPTION_KEY eksik. OAuth erişim anahtarlarını güvenle saklamak için 32 baytlık Base64 anahtar oluştur.');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('JARVIS_TOKEN_ENCRYPTION_KEY geçersiz. 32 baytlık Base64 anahtar olmalı.');
  return key;
}

function encrypt(value: OAuthTokenSet): EncryptedToken {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(value: EncryptedToken): OAuthTokenSet {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(value.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(cleartext) as OAuthTokenSet;
}

function readStore(): IntegrationStore {
  if (!existsSync(DATA_FILE)) return {};
  const data: unknown = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Bağlı hesaplar dosyası okunamıyor. Dosya biçimi beklenmiyor.');
  }
  return data as IntegrationStore;
}

function writeStore(store: IntegrationStore): void {
  const directory = join(process.cwd(), 'data');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${DATA_FILE}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temporary, JSON.stringify(store), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, DATA_FILE);
}

export function providerLabel(provider: IntegrationProvider): string {
  return provider === 'google' ? 'Google Gmail + Takvim' : 'Microsoft Outlook + Takvim';
}

export function isIntegrationProvider(value: string): value is IntegrationProvider {
  return value === 'google' || value === 'microsoft';
}

export { localRequestAllowed as integrationRequestAllowed } from './request-origin';

export function oauthBaseUrl(requestOrigin?: string): string {
  const configured = process.env.JARVIS_BASE_URL;
  const base = configured || requestOrigin;
  if (!base) throw new Error('JARVIS_BASE_URL yapılandırılmamış.');
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    throw new Error('JARVIS_BASE_URL geçerli bir HTTPS adresi olmalı.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('OAuth güvenliği için JARVIS_BASE_URL HTTPS olmalı (yerel geliştirmede localhost kullanılabilir).');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('JARVIS_BASE_URL kullanıcı bilgisi, sorgu veya fragment içeremez.');
  }
  return url.toString().replace(/\/+$/u, '');
}

export function callbackUrl(baseUrl: string, provider: IntegrationProvider): string {
  return `${baseUrl}/api/integrations/callback/${provider}`;
}

export function oauthConfiguration(provider: IntegrationProvider) {
  const setup = providerSetup(provider);
  if (!setup.configured || !setup.clientId || !setup.clientSecret) {
    throw new Error(`${providerLabel(provider)} OAuth kurulumu eksik. Sunucuda ${setup.missing.join(', ')} tanımlanmalı.`);
  }
  if (provider === 'google') {
    return {
      clientId: setup.clientId,
      clientSecret: setup.clientSecret,
      authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenEndpoint: 'https://oauth2.googleapis.com/token',
      scopes: GOOGLE_SCOPES,
    };
  }
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  if (!/^[a-zA-Z0-9.-]+$/u.test(tenant)) throw new Error('MICROSOFT_TENANT_ID biçimi geçersiz.');
  return {
    clientId: setup.clientId,
    clientSecret: setup.clientSecret,
    authorizationEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scopes: MICROSOFT_SCOPES,
  };
}

export function saveIntegration(provider: IntegrationProvider, token: OAuthTokenSet): void {
  const store = readStore();
  const previous = store[provider] ? decrypt(store[provider]!.token) : null;
  const preserved = token.refreshToken || previous?.refreshToken || '';
  if (!preserved) throw new Error('Sağlayıcı yenileme anahtarı vermedi. Erişimi yenileyip çevrimdışı erişime izin ver.');
  store[provider] = {
    token: encrypt({ ...token, refreshToken: preserved }),
  };
  writeStore(store);
}

export function removeIntegration(provider: IntegrationProvider): void {
  const store = readStore();
  delete store[provider];
  writeStore(store);
}

export function integrationStatus(provider: IntegrationProvider) {
  const setup = providerSetup(provider);
  const stored = readStore()[provider];
  let token: OAuthTokenSet | null = null;
  if (stored) token = decrypt(stored.token);
  return {
    provider,
    name: providerLabel(provider),
    configured: setup.configured,
    connected: Boolean(token),
    email: token?.accountEmail || null,
    connectedAt: token?.connectedAt || null,
    setupMessage: setup.configured
      ? undefined
      : `Sunucu yöneticisi OAuth uygulamasını yapılandırmalı: ${setup.missing.join(', ')}.`,
  };
}

export function readIntegration(provider: IntegrationProvider): OAuthTokenSet | null {
  const stored = readStore()[provider];
  return stored ? decrypt(stored.token) : null;
}

export async function validAccessToken(provider: IntegrationProvider): Promise<string> {
  const token = readIntegration(provider);
  if (!token) throw new Error(`${providerLabel(provider)} hesabı bağlı değil.`);
  if (token.expiresAt > Date.now() + 60_000) return token.accessToken;

  const config = oauthConfiguration(provider);
  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
      scope: config.scopes.join(' '),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const refreshed: unknown = await response.json();
  if (!response.ok || !refreshed || typeof refreshed !== 'object') {
    throw new Error('OAuth erişimi yenilenemedi. Bağlı hesabı kaldırıp yeniden bağla.');
  }
  const record = refreshed as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || typeof record.expires_in !== 'number') {
    throw new Error('OAuth yenileme yanıtı beklenen biçimde değil.');
  }
  const next: OAuthTokenSet = {
    ...token,
    accessToken: record.access_token,
    refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : token.refreshToken,
    expiresAt: Date.now() + record.expires_in * 1000,
  };
  saveIntegration(provider, next);
  return next.accessToken;
}

export function stateMatches(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
