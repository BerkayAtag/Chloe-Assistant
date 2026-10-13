import { NextResponse } from 'next/server';
import {
  integrationRequestAllowed,
  isIntegrationProvider,
  validAccessToken,
} from '@/lib/jarvis-integrations';

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'E-posta entegrasyonlarına yalnızca bu cihazdaki yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'E-posta entegrasyonlarına yalnızca bu cihazdaki yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  const { provider: value } = await context.params;
  if (!isIntegrationProvider(value)) {
    return NextResponse.json({ error: 'E-posta sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || (input as Record<string, unknown>).confirm !== true) {
      return NextResponse.json({ error: 'Gönderim için alıcı ve içerik incelenip açıkça onaylanmalı.' }, { status: 400 });
    }
    const draftId = (input as Record<string, unknown>).draftId;
    if (typeof draftId !== 'string' || !/^[\w-]{1,256}$/u.test(draftId)) {
      return NextResponse.json({ error: 'Taslak kimliği geçersiz.' }, { status: 400 });
    }
    const accessToken = await validAccessToken(value);
    const url = value === 'google'
      ? 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send'
      : `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(draftId)}/send`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: value === 'google' ? JSON.stringify({ id: draftId }) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const error = data && typeof data === 'object' && 'error' in data
        ? (data as { error?: { message?: string } }).error?.message
        : undefined;
      throw new Error(error || `E-posta gönderilemedi (${response.status}).`);
    }
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'E-posta gönderilemedi.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
