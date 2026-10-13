import { connection, NextResponse } from 'next/server';
import {
  callbackUrl,
  integrationRequestAllowed,
  integrationStatus,
  oauthBaseUrl,
  type IntegrationProvider,
} from '@/lib/jarvis-integrations';
import { localRequestOrigin } from '@/lib/request-origin';

export async function GET(request: Request) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'Hesap bağlantılarına yalnızca yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  try {
    await connection();
    let baseUrl: string;
    try {
      baseUrl = oauthBaseUrl(localRequestOrigin(request) || undefined);
    } catch {
      baseUrl = localRequestOrigin(request) || 'http://127.0.0.1:3004';
    }
    const integrations = (['google', 'microsoft'] as IntegrationProvider[])
      .map((provider) => ({ ...integrationStatus(provider), callbackUrl: callbackUrl(baseUrl, provider) }));
    return NextResponse.json({ integrations });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Bağlantılar okunamadı.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
