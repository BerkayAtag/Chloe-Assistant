/**
 * Speech-to-Text API — Now supporting Deepgram as a provider
 *
 * Ported from Jarvis AI Assistant:
 *   src/transcription/deepgram-streaming-transcriber.ts
 *   src/transcription/deepgram-transcriber.ts
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 * License: MIT
 */

import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { DeepgramSTTClient, type DeepgramSTTConfig } from '@/lib/deepgram-stt';

export const maxDuration = 30;
const MAX_BODY_BYTES = 8_016_000;

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Yerel Chloe isteği gerekli.' }, { status: 403 });

  try {
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Ses isteği çok büyük.' }, { status: 413 });
    }
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_BODY_BYTES) {
            await reader.cancel();
            return NextResponse.json({ error: 'Ses isteği çok büyük.' }, { status: 413 });
          }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
    }
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return NextResponse.json({ error: 'İstek JSON biçiminde olmalı.' }, { status: 400 }); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'İstek biçimi geçersiz.' }, { status: 400 });
    }

    if (!body.apiKey || typeof body.apiKey !== 'string') {
      return NextResponse.json({ error: 'Deepgram API anahtari gerekli.' }, { status: 400 });
    }

    if (!body.audio && !body.audioBase64) {
      return NextResponse.json({ error: 'Ses verisi gerekli (audio Buffer veya audioBase64).' }, { status: 400 });
    }

    const config: Partial<DeepgramSTTConfig> = {
      model: body.model || 'nova-3',
      language: body.language || 'en-US',
      smart_format: body.smart_format ?? true,
      punctuate: body.punctuate ?? true,
      capitalization: body.capitalization ?? true,
    };

    const client = new DeepgramSTTClient(body.apiKey, config);

    const encoded = body.audioBase64 ?? body.audio;
    if (typeof encoded !== 'string' || !encoded.length || encoded.length > 8_000_000 ||
        encoded.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(encoded)) {
      return NextResponse.json({ error: 'Ses verisi geçersiz veya 6 MB sınırını aşıyor.' }, { status: 400 });
    }
    const audioBuffer = Buffer.from(encoded, 'base64');
    if (audioBuffer.toString('base64') !== encoded) {
      return NextResponse.json({ error: 'Ses verisi geçerli base64 olmalı.' }, { status: 400 });
    }

    const result = await client.transcribe(audioBuffer, request.signal);

    return NextResponse.json({
      text: result.text,
      confidence: result.confidence,
      isFinal: result.isFinal,
      provider: 'deepgram',
      model: config.model,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deepgram transkripsiyon basarisiz.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
