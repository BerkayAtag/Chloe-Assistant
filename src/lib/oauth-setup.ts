export type IntegrationProvider = 'google' | 'microsoft';

export function providerSetup(provider: IntegrationProvider) {
  const clientId = process.env[provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'MICROSOFT_CLIENT_ID'];
  const clientSecret = process.env[provider === 'google' ? 'GOOGLE_CLIENT_SECRET' : 'MICROSOFT_CLIENT_SECRET'];
  const encodedKey = process.env.JARVIS_TOKEN_ENCRYPTION_KEY || '';
  const validEncryptionKey = /^[A-Za-z0-9+/]+={0,2}$/.test(encodedKey) && Buffer.from(encodedKey, 'base64').length === 32;
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
    !validEncryptionKey && (encodedKey ? 'JARVIS_TOKEN_ENCRYPTION_KEY (32 bayt Base64 anahtar gerekli)' : 'JARVIS_TOKEN_ENCRYPTION_KEY'),
    invalidBaseUrl && 'JARVIS_BASE_URL (HTTPS veya localhost adresi gerekli)',
  ].filter(Boolean);
  return {
    configured: missing.length === 0,
    missing: missing as string[],
    clientId,
    clientSecret,
  };
}
