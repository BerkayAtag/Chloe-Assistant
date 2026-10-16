import { createHash, randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { localRequestOrigin } from '@/lib/request-origin';
import { normalizeEmail } from '@/lib/email-provider';
import {
  callbackUrl,
  integrationRequestAllowed,
  isIntegrationProvider,
  oauthBaseUrl,
  oauthConfiguration,
} from '@/lib/jarvis-integrations';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'Hesap bağlantıları yalnızca yerel Chloe uygulamasından başlatılabilir.' }, { status: 403 });
  }
  const { provider: rawProvider } = await context.params;
  if (!isIntegrationProvider(rawProvider)) {
    return NextResponse.json({ error: 'Bu OAuth sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }

  try {
    const emailInput = request.nextUrl.searchParams.get('email');
    let email = '';
    try { email = emailInput ? normalizeEmail(emailInput) : ''; }
    catch { return NextResponse.json({ error: 'Geçerli bir e-posta adresi yaz.' }, { status: 400 }); }
    const config = oauthConfiguration(rawProvider);
    const baseUrl = oauthBaseUrl(localRequestOrigin(request) || undefined);
    const redirectUri = callbackUrl(baseUrl, rawProvider);
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(config.authorizationEndpoint);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: config.scopes.join(' '),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...(email ? { login_hint: email } : {}),
      ...(rawProvider === 'google'
        ? { access_type: 'offline', prompt: 'consent' }
        : { response_mode: 'query', prompt: 'select_account' }),
    }).toString();
    const response = NextResponse.redirect(url);
    response.cookies.set('chloe_jarvis_oauth', Buffer.from(JSON.stringify({
      provider: rawProvider,
      state,
      verifier,
      redirectUri,
    })).toString('base64url'), {
      httpOnly: true,
      sameSite: 'lax',
      secure: new URL(baseUrl).protocol === 'https:',
      path: '/api/integrations',
      maxAge: 600,
    });
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'OAuth bağlantısı başlatılamadı.';
    return NextResponse.json({ error: message }, { status: 503 });
  }
}
