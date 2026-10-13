import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { mediaConnection, MediaConfigurationError, providerFailure, readLimitedBytes } from '@/lib/media-provider';
export const maxDuration = 90;
const voices = ['Kore', 'Aoede', 'Leda', 'Sulafat', 'Zephyr', 'Achernar'];
export async function POST(request: Request) {
  let settings = DEFAULT_SETTINGS;
  try {
    if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Ses isteği bu uygulamadan yapılmalı.' }, { status: 403 });
    const body = await request.json();
    if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 12000) return NextResponse.json({ error: 'Ses metni 1–12.000 karakter olmalı.' }, { status: 400 });
    if (!hasExplicitConnection(body.settings)) return NextResponse.json({ error: 'Ses isteğinde etkin ana model ayarları gerekli. Uygulamayı yenile.' }, { status: 400 });
    settings = { ...DEFAULT_SETTINGS, ...body.settings } as Settings;
    const connection = mediaConnection(settings, 'speech', process.env.GEMINI_API_KEY);
    const { key } = connection;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(75000)]);
    if (connection.adapter === 'compatible') {
      const response = await fetch(`${connection.baseUrl}/audio/speech`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, signal, redirect: 'error',
        body: JSON.stringify({ model: connection.model, input: body.text, voice: settings.customSpeechVoice || 'nova', response_format: 'mp3' }),
      });
      if (!response.ok) throw await providerFailure(response, connection.name);
      const mime = response.headers.get('content-type')?.split(';')[0] || '';
      if (!/^audio\/(mpeg|mp3|wav|x-wav|ogg|aac|flac|webm)$/.test(mime)) throw new Error(`${connection.name} oynatılabilir ses yerine başka bir yanıt verdi.`);
      return new Response(new Uint8Array(await readLimitedBytes(response, 25 * 1024 * 1024)), { headers: { 'Content-Type': mime, 'Cache-Control': 'no-store' } });
    }
    const style = body.tone === 'warm' ? 'warm, friendly and expressive, with gentle natural variation' : body.tone === 'calm' ? 'calm, reassuring and unhurried, with natural pauses' : 'conversational and humanlike, relaxed and clear, never robotic or overly theatrical';
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      signal, redirect: 'error',
      body: JSON.stringify({ model: connection.model, store: false,
        input: [{ type: 'user_input', content: [{ type: 'text', text: body.text, annotations: [{ type: 'speech_metadata', style: `Speak Turkish fluently; ${style}. Read only the provided text.` }] }] }],
        response_format: { type: 'audio' }, generation_config: { speech_config: [{ voice: voices.includes(body.voice) ? body.voice : 'Kore' }] },
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      const failure = Object.assign(new Error(typeof data.error?.message === 'string' ? data.error.message : 'Ses servisi yanıt vermedi.'), { statusCode: response.status });
      return NextResponse.json({ error: `Gemini doğal ses: ${modelErrorMessage(failure, [key])}` }, { status: 502 });
    }
    const blocks = (data.steps || []).flatMap((step: { content?: { type: string; data?: string; mime_type?: string }[] }) => step.content || []);
    const audio = [...blocks].reverse().find((block: { type: string; data?: string }) => block.type === 'audio' && block.data) || data.output_audio;
    if (!audio?.data) throw new Error('Ses modeli boş yanıt verdi.');
    let bytes = Buffer.from(audio.data, 'base64');
    const mime = audio.mime_type || 'audio/wav';
    if (bytes.length > 25 * 1024 * 1024) throw new Error('Ses yanıtı boyut sınırını aştı.');
    if (/pcm|L16/i.test(mime)) {
      const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(bytes.length + 36, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(bytes.length, 40); bytes = Buffer.concat([header, bytes]);
    }
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': /pcm|L16/i.test(mime) ? 'audio/wav' : mime, 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'Ses üretimi durduruldu veya zaman aşımına uğradı.' : modelErrorMessage(error, modelSecrets(settings)) }, { status: error instanceof MediaConfigurationError ? 422 : 502 });
  }
}
