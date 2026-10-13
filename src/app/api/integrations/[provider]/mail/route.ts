import { NextResponse } from 'next/server';
import {
  integrationRequestAllowed,
  isIntegrationProvider,
  validAccessToken,
} from '@/lib/jarvis-integrations';

const EMAIL_PATTERN = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/u;

async function providerResponse(url: string, accessToken: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const data: unknown = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? (data as { error?: { message?: string } }).error?.message
      : undefined;
    throw new Error(message || `E-posta sağlayıcısı isteği reddetti (${response.status}).`);
  }
  return data;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'E-posta entegrasyonlarına yalnızca bu cihazdaki yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  const { provider: value } = await context.params;
  if (!isIntegrationProvider(value)) {
    return NextResponse.json({ error: 'E-posta sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }
  try {
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') || '').trim().slice(0, 180);
    const accessToken = await validAccessToken(value);
    if (value === 'google') {
      const q = query || 'in:inbox newer_than:14d';
      const list = await providerResponse(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=12&q=${encodeURIComponent(q)}`,
        accessToken
      ) as { messages?: Array<{ id: string }> };
      const messages = await Promise.all((list.messages || []).slice(0, 12).map(async (item) => {
        const message = await providerResponse(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
          accessToken
        ) as { id?: string; snippet?: string; payload?: { headers?: Array<{ name: string; value: string }> } };
        const headers = new Map((message.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value]));
        return {
          id: message.id || item.id,
          from: headers.get('from') || '',
          to: headers.get('to') || '',
          subject: headers.get('subject') || '(Konu yok)',
          date: headers.get('date') || '',
          preview: message.snippet || '',
        };
      }));
      return NextResponse.json({ messages });
    }

    const graphUrl = new URL('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages');
    graphUrl.searchParams.set('$top', '12');
    graphUrl.searchParams.set('$select', 'id,subject,from,toRecipients,receivedDateTime,bodyPreview,isRead');
    graphUrl.searchParams.set('$orderby', 'receivedDateTime desc');
    if (query) graphUrl.searchParams.set('$search', `"${query.replace(/["\r\n]/gu, ' ')}"`);
    const result = await providerResponse(graphUrl.toString(), accessToken, {
      headers: query ? { ConsistencyLevel: 'eventual' } : undefined,
    }) as { value?: Array<Record<string, unknown>> };
    return NextResponse.json({
      messages: (result.value || []).map((message) => ({
        id: message.id,
        from: (message.from as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress?.address || '',
        to: ((message.toRecipients as Array<{ emailAddress?: { address?: string } }> | undefined) || [])
          .map((recipient) => recipient.emailAddress?.address).filter(Boolean).join(', '),
        subject: typeof message.subject === 'string' ? message.subject : '(Konu yok)',
        date: typeof message.receivedDateTime === 'string' ? message.receivedDateTime : '',
        preview: typeof message.bodyPreview === 'string' ? message.bodyPreview : '',
        isRead: message.isRead === true,
      })),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'E-posta alınamadı.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'E-posta entegrasyonlarına yalnızca bu cihazdaki yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  const { provider: value } = await context.params;
  if (!isIntegrationProvider(value)) {
    return NextResponse.json({ error: 'E-posta sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }

  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Taslak alanları geçerli bir nesne olmalı.' }, { status: 400 });
    }
    const input = body as Record<string, unknown>;
    const recipients = typeof input.to === 'string'
      ? input.to.split(',').map((email) => email.trim()).filter(Boolean)
      : [];
    const subject = typeof input.subject === 'string' ? input.subject.trim() : '';
    const message = typeof input.body === 'string' ? input.body.trim() : '';
    if (!recipients.length || recipients.length > 10 || recipients.some((email) => !EMAIL_PATTERN.test(email))) {
      return NextResponse.json({ error: 'Bir veya daha fazla geçerli alıcı e-posta adresi gir.' }, { status: 400 });
    }
    if (!subject || subject.length > 200 || /[\r\n]/u.test(subject)) {
      return NextResponse.json({ error: 'E-posta konusu boş olamaz ve 200 karakteri aşamaz.' }, { status: 400 });
    }
    if (!message || message.length > 15_000) {
      return NextResponse.json({ error: 'E-posta metni boş olamaz ve 15.000 karakteri aşamaz.' }, { status: 400 });
    }
    const accessToken = await validAccessToken(value);
    if (value === 'google') {
      const mime = [
        `To: ${recipients.join(', ')}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        Buffer.from(message, 'utf8').toString('base64'),
      ].join('\r\n');
      const draft = await providerResponse(
        'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
        accessToken,
        {
          method: 'POST',
          body: JSON.stringify({ message: { raw: Buffer.from(mime, 'utf8').toString('base64url') } }),
        }
      ) as { id?: string };
      if (!draft.id) throw new Error('Gmail taslak kimliği dönmedi.');
      return NextResponse.json({ success: true, draftId: draft.id, subject });
    }
    const draft = await providerResponse(
      'https://graph.microsoft.com/v1.0/me/messages',
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          subject,
          body: { contentType: 'Text', content: message },
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
        }),
      }
    ) as { id?: string };
    if (!draft.id) throw new Error('Outlook taslak kimliği dönmedi.');
    return NextResponse.json({ success: true, draftId: draft.id, subject });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'E-posta taslağı kaydedilemedi.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
