import { NextResponse } from 'next/server';
import {
  integrationRequestAllowed,
  isIntegrationProvider,
  validAccessToken,
} from '@/lib/jarvis-integrations';

async function jsonResponse(response: Response) {
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data
      ? (data as { error?: { message?: string } }).error?.message
      : undefined;
    throw new Error(message || `Takvim isteği reddedildi (${response.status}).`);
  }
  return data as Record<string, unknown>;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'Takvim entegrasyonlarına yalnızca bu cihazdaki yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  const { provider: value } = await context.params;
  if (!isIntegrationProvider(value)) {
    return NextResponse.json({ error: 'Takvim sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }
  try {
    const accessToken = await validAccessToken(value);
    const now = new Date();
    const later = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const url = value === 'google'
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?${new URLSearchParams({
          timeMin: now.toISOString(),
          timeMax: later.toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '20',
        })}`
      : `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({
          startDateTime: now.toISOString(),
          endDateTime: later.toISOString(),
          '$orderby': 'start/dateTime',
          '$top': '20',
          '$select': 'id,subject,start,end,location,webLink',
        })}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"' },
      signal: AbortSignal.timeout(15_000),
    });
    const data = await jsonResponse(response);
    const items = value === 'google'
      ? (data.items as Array<Record<string, unknown>> | undefined) || []
      : (data.value as Array<Record<string, unknown>> | undefined) || [];
    const events = items.map((event) => ({
      id: typeof event.id === 'string' ? event.id : '',
      title: typeof event.summary === 'string'
        ? event.summary
        : typeof event.subject === 'string' ? event.subject : '(Başlıksız)',
      start: value === 'google'
        ? (event.start as { dateTime?: string; date?: string } | undefined)?.dateTime ||
          (event.start as { dateTime?: string; date?: string } | undefined)?.date || ''
        : (event.start as { dateTime?: string } | undefined)?.dateTime || '',
      end: value === 'google'
        ? (event.end as { dateTime?: string; date?: string } | undefined)?.dateTime ||
          (event.end as { dateTime?: string; date?: string } | undefined)?.date || ''
        : (event.end as { dateTime?: string } | undefined)?.dateTime || '',
      location: typeof event.location === 'string'
        ? event.location
        : (event.location as { displayName?: string } | undefined)?.displayName || '',
      url: typeof event.htmlLink === 'string'
        ? event.htmlLink
        : typeof event.webLink === 'string' ? event.webLink : '',
    }));
    return NextResponse.json({ events });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Takvim alınamadı.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> }
) {
  if (!integrationRequestAllowed(request)) {
    return NextResponse.json({ error: 'Takvim entegrasyonlarına yalnızca bu cihazdaki yerel Chloe uygulamasından erişilebilir.' }, { status: 403 });
  }
  const { provider: value } = await context.params;
  if (!isIntegrationProvider(value)) {
    return NextResponse.json({ error: 'Takvim sağlayıcısı desteklenmiyor.' }, { status: 404 });
  }
  try {
    const input: unknown = await request.json();
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return NextResponse.json({ error: 'Takvim etkinliği alanları geçerli değil.' }, { status: 400 });
    }
    const record = input as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const start = typeof record.start === 'string' ? new Date(record.start) : null;
    const end = typeof record.end === 'string' ? new Date(record.end) : null;
    if (record.confirm !== true) {
      return NextResponse.json({ error: 'Etkinlik özeti incelenip kullanıcı tarafından onaylanmalı.' }, { status: 400 });
    }
    if (!title || title.length > 200 || !start || !end || !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) || end <= start || start < new Date(Date.now() - 60_000)) {
      return NextResponse.json({ error: 'Başlık ve geçerli bir gelecek başlangıç/bitiş zamanı gir.' }, { status: 400 });
    }
    const description = typeof record.description === 'string' ? record.description.trim().slice(0, 5000) : '';
    const location = typeof record.location === 'string' ? record.location.trim().slice(0, 500) : '';
    const accessToken = await validAccessToken(value);
    const response = value === 'google'
      ? await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: title,
            description,
            location,
            start: { dateTime: start.toISOString() },
            end: { dateTime: end.toISOString() },
          }),
          signal: AbortSignal.timeout(15_000),
        })
      : await fetch('https://graph.microsoft.com/v1.0/me/events', {
          method: 'POST',
          headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: title,
            body: { contentType: 'Text', content: description },
            location: { displayName: location },
            start: { dateTime: start.toISOString(), timeZone: 'UTC' },
            end: { dateTime: end.toISOString(), timeZone: 'UTC' },
          }),
          signal: AbortSignal.timeout(15_000),
        });
    const event = await jsonResponse(response);
    return NextResponse.json({ success: true, id: event.id, title });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Takvim etkinliği oluşturulamadı.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
