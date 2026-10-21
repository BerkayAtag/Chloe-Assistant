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

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Yerel Chloe isteği gerekli.' }, { status: 403 });

  try {
    const body = await request.json();

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

    // Convert base64 to Buffer if provided
    let audioBuffer: Buffer;
    if (body.audioBase64) {
      const binaryStr = Buffer.from(body.audioBase64, 'base64').toString('binary');
      const bytes = new Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      audioBuffer = Buffer.from(bytes);
    } else {
      audioBuffer = Buffer.from(body.audio, 'base64');
    }

    const result = await client.transcribe(audioBuffer);

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
