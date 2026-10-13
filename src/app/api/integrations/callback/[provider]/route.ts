import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { localRequestOrigin } from '@/lib/request-origin';
import {
  callbackUrl,
  integrationRequestAllowed,
  isIntegrationProvider,
  oauthBaseUrl,
  oauthConfiguration,
  saveIntegration,
  stateMatches,
  type OAuthTokenSet,
} from '@/lib/jarvis-integrations';

type OAuthSession = {
  provider: string;
  state: string;
  verifier: string;
  redirectUri: string;
};

async function fail(baseUrl: string, message: string) {
  const response = NextResponse.redirect(
    `${baseUrl}/?jarvis=${encodeURIComponent(`error:${message}`)}`
  );
  response.cookies.set('chloe_jarvis_oauth', '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(baseUrl).protocol === 'https:',
    path: '/api/integrations',
    maxAge: 0,
  });
  return response;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  const { provider: queryProvider } = await context.params;
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'OAuth dönüşü yalnızca yerel Chloe sunucusunda kabul edilir.' }, { status: 403 });
  }
  const baseUrl = (() => {
    try {
      return oauthBaseUrl(localRequestOrigin(request) || undefined);
    } catch {
      return 'http://127.0.0.1:3004';
    }
  })();
  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const providerError = request.nextUrl.searchParams.get('error');
  const cookieStore = await cookies();
  const cookie = cookieStore.get('chloe_jarvis_oauth')?.value;

  if (providerError) return fail(baseUrl, 'OAuth izni verilmedi veya sağlayıcı bağlantıyı reddetti.');
  if (!isIntegrationProvider(queryProvider) || !code || !state || !cookie) {
    return fail(baseUrl, 'OAuth dönüş bilgisi eksik veya zaman aşımına uğradı.');
  }

  let session: OAuthSession;
  try {
    session = JSON.parse(Buffer.from(cookie, 'base64url').toString('utf8')) as OAuthSession;
  } catch {
    return fail(baseUrl, 'OAuth güvenlik oturumu geçersiz.');
  }
  if (session.provider !== queryProvider || !stateMatches(session.state, state)) {
    return fail(baseUrl, 'OAuth güvenlik doğrulaması başarısız oldu. Bağlantıyı yeniden başlat.');
  }

  try {
    const config = oauthConfiguration(queryProvider);
    const expectedRedirect = callbackUrl(baseUrl, queryProvider);
    if (session.redirectUri !== expectedRedirect) {
      return fail(baseUrl, 'OAuth yönlendirme adresi değişti. Bağlantıyı yeniden başlat.');
    }
    const response = await fetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: expectedRedirect,
        code_verifier: session.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const tokenData: unknown = await response.json();
    if (!response.ok || !tokenData || typeof tokenData !== 'object') {
      throw new Error('OAuth erişim anahtarı alınamadı. İstemci kimliği ve dönüş adresini kontrol et.');
    }
    const record = tokenData as Record<string, unknown>;
    if (typeof record.access_token !== 'string' || typeof record.expires_in !== 'number') {
      throw new Error('OAuth sağlayıcısı beklenmeyen bir token yanıtı verdi.');
    }
    const accessToken = record.access_token;
    const profileResponse = await fetch(
      queryProvider === 'google'
        ? 'https://openidconnect.googleapis.com/v1/userinfo'
        : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) }
    );
    const profile: unknown = await profileResponse.json();
    if (!profileResponse.ok || !profile || typeof profile !== 'object') {
      throw new Error('Hesap e-posta adresi sağlayıcıdan alınamadı.');
    }
    const fields = profile as Record<string, unknown>;
    const email = queryProvider === 'google'
      ? fields.email
      : fields.mail || fields.userPrincipalName;
    if (typeof email !== 'string') throw new Error('Sağlayıcı hesap e-posta adresi döndürmedi.');

    const token: OAuthTokenSet = {
      accessToken,
      refreshToken: typeof record.refresh_token === 'string' ? record.refresh_token : '',
      expiresAt: Date.now() + record.expires_in * 1000,
      scope: typeof record.scope === 'string' ? record.scope : '',
      accountEmail: email,
      connectedAt: new Date().toISOString(),
    };
    saveIntegration(queryProvider, token);
    const success = NextResponse.redirect(`${baseUrl}/?jarvis=connected`);
    success.cookies.set('chloe_jarvis_oauth', '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(baseUrl).protocol === 'https:',
      path: '/api/integrations',
      maxAge: 0,
    });
    return success;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Hesap bağlanamadı.';
    return fail(baseUrl, message);
  }
}
