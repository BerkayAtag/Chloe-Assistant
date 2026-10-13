import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { setTimeout as delay } from 'node:timers/promises';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { mediaConnection, MediaConfigurationError, providerFailure, readLimitedBytes } from '@/lib/media-provider';
import { readPublicImage } from '@/lib/public-page';
import { localRequestAllowed } from '@/lib/request-origin';

export const maxDuration = 300;

type GenerateBody = {
  type: 'image' | 'video';
  prompt: string;
  imageData?: string;
  settings?: Partial<Settings>;
};

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_PROMPT_LENGTH = 8_000;
const MAX_IMAGE_DATA_LENGTH = 20_000_000;

function errorMessage(data: unknown, fallback: string): string {
  if (typeof data === 'object' && data && 'error' in data) {
    const error = (data as { error?: { message?: string } }).error;
    if (error?.message) return error.message;
  }
  return fallback;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const data: unknown = await response.json();
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('Google API beklenmeyen bir yanıt verdi.');
  }
  return data as Record<string, unknown>;
}

async function saveOutput(
  bytes: Uint8Array,
  extension: 'jpg' | 'png' | 'webp' | 'mp4',
  mimeType: string
) {
  const id = randomUUID();
  const dir = path.join(process.cwd(), 'data', 'uploads');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}-generated.${extension}`), bytes);
  return { id, url: `/api/files/${id}`, mimeType };
}

function imageDataUrl(value: string | undefined) {
  if (!value) return null;
  if (value.length > MAX_IMAGE_DATA_LENGTH) {
    throw new Error('Görsel çok büyük. Lütfen 15 MB altındaki bir dosya seç.');
  }
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/);
  if (!match) throw new Error('Düzenlenecek görsel geçerli bir JPEG, PNG veya WebP olmalı.');
  return { mimeType: match[1], data: match[2] };
}

function findGeneratedImage(value: unknown): { data: string; mimeType: string } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.data === 'string') {
    const mimeType =
      (typeof record.mime_type === 'string' && record.mime_type) ||
      (typeof record.mimeType === 'string' && record.mimeType) ||
      'image/png';
    if (mimeType.startsWith('image/')) return { data: record.data, mimeType };
  }
  for (const child of Object.values(record)) {
    const found = findGeneratedImage(child);
    if (found) return found;
  }
  return null;
}

async function generateImage(body: GenerateBody, key: string, signal: AbortSignal) {
  const source = imageDataUrl(body.imageData);
  const input: Array<Record<string, string>> = [];
  if (source) {
    input.push({ type: 'image', mime_type: source.mimeType, data: source.data });
  }
  input.push({ type: 'text', text: body.prompt });

  const response = await fetch(`${GEMINI_API}/interactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify({ model: 'gemini-nano-banana-2.1', input }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });
  const data = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(data, 'Görsel üretilemedi.'));

  const image = findGeneratedImage(data.output_image ?? data.output ?? data);
  if (!image) {
    throw new Error('Model görsel üretmedi. Gemini hesabında görsel üretiminin açık olduğunu kontrol et.');
  }
  const bytes = Buffer.from(image.data, 'base64');
  if (!bytes.length) throw new Error('Model boş bir görsel döndürdü.');

  const extension = image.mimeType === 'image/jpeg' ? 'jpg' : 'png';
  return {
    ...(await saveOutput(bytes, extension, image.mimeType)),
    prompt: body.prompt,
  };
}

async function generateVideo(body: GenerateBody, key: string, signal: AbortSignal) {
  const source = imageDataUrl(body.imageData);
  const instance: Record<string, unknown> = { prompt: body.prompt };
  if (source) {
    instance.image = {
      mimeType: source.mimeType,
      bytesBase64Encoded: source.data,
    };
  }

  const response = await fetch(
    `${GEMINI_API}/models/veo-3.1-generate-preview:predictLongRunning`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        instances: [instance],
        parameters: { aspectRatio: '16:9', resolution: '720p' },
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    }
  );
  let operation = await readJson(response);
  if (!response.ok) {
    throw new Error(errorMessage(operation, 'Video üretimi başlatılamadı.'));
  }
  const operationName = operation.name;
  if (typeof operationName !== 'string' || !/^models\/veo-[\w.-]+\/operations\/[\w.-]+$/u.test(operationName)) {
    throw new Error('Video işlemi başlatıldı ancak geçerli işlem kimliği alınamadı.');
  }

  const deadline = Date.now() + 270_000;
  while (operation.done !== true && Date.now() < deadline) {
    await delay(5000, undefined, { signal });
    const status = await fetch(`${GEMINI_API}/${operationName}`, {
      headers: { 'x-goog-api-key': key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    operation = await readJson(status);
    if (!status.ok || operation.error) {
      throw new Error(errorMessage(operation, 'Video üretimi başarısız oldu.'));
    }
  }
  if (operation.done !== true) throw new Error('Video üretimi zaman aşımına uğradı.');

  const responseData = operation.response;
  if (!responseData || typeof responseData !== 'object') {
    throw new Error('Video üretildi ancak dosya bilgisi alınamadı.');
  }
  const generated = responseData as Record<string, unknown>;
  const videoResponse = generated.generateVideoResponse as Record<string, unknown> | undefined;
  const firstSample = (videoResponse?.generatedSamples as Array<Record<string, unknown>> | undefined)?.[0];
  const sampleVideo = firstSample?.video as Record<string, unknown> | undefined;
  const generatedVideos = generated.generatedVideos as Array<Record<string, unknown>> | undefined;
  const generatedVideo = generatedVideos?.[0]?.video as Record<string, unknown> | undefined;
  const uri = sampleVideo?.uri ?? generatedVideo?.uri;
  if (typeof uri !== 'string') throw new Error('Video üretildi ancak indirme adresi alınamadı.');

  const videoUrl = new URL(uri);
  if (videoUrl.protocol !== 'https:' || videoUrl.username || videoUrl.password || !['generativelanguage.googleapis.com', 'storage.googleapis.com'].includes(videoUrl.hostname)) throw new Error('Video indirme adresi beklenen Google hizmetine ait değil.');
  const video = await fetch(videoUrl, {
    headers: videoUrl.hostname === 'generativelanguage.googleapis.com' ? { 'x-goog-api-key': key } : {},
    redirect: 'error',
    signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
  });
  if (!video.ok) throw new Error(`Üretilen video indirilemedi (${video.status}).`);
  const bytes = new Uint8Array(await video.arrayBuffer());
  if (!bytes.length) throw new Error('İndirilen video dosyası boş.');

  return {
    ...(await saveOutput(bytes, 'mp4', 'video/mp4')),
    prompt: body.prompt,
  };
}

export async function POST(request: Request) {
  let key = '';
  let settings = DEFAULT_SETTINGS;
  try {
    if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Üretim isteği bu uygulamadan yapılmalı.' }, { status: 403 });
    const body = (await request.json()) as GenerateBody;
    if (body.type !== 'image' && body.type !== 'video') {
      return NextResponse.json({ error: 'Üretim türü image veya video olmalı.' }, { status: 400 });
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) return NextResponse.json({ error: 'Bir açıklama yazmalısın.' }, { status: 400 });
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: 'Açıklama 8.000 karakteri aşamaz.' }, { status: 400 });
    }

    if (!hasExplicitConnection(body.settings)) return NextResponse.json({ error: 'Üretim için etkin ana model ayarları gerekli. Uygulamayı yenile.' }, { status: 400 });
    settings = { ...DEFAULT_SETTINGS, ...body.settings };
    const connection = mediaConnection(settings, body.type, process.env.GEMINI_API_KEY);
    key = connection.key;
    if (connection.adapter === 'compatible') {
      if (body.imageData) throw new MediaConfigurationError('Seçili API için görsel düzenleme bağlantısı henüz tanımlı değil. Kaynak görsel görmezden gelinmedi ve başka sağlayıcıya geçilmedi.');
      const response = await fetch(`${connection.baseUrl}/${body.type === 'image' ? 'images' : 'videos'}/generations`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.any([request.signal, AbortSignal.timeout(body.type === 'image' ? 120000 : 300000)]),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: connection.model, prompt, ...(body.type === 'image' ? { n: 1, response_format: 'b64_json' } : { duration: 6, aspect_ratio: '16:9' }) }),
      });
      if (!response.ok) throw await providerFailure(response, connection.name);
      let bytes: Uint8Array; let mime: string; let extension: 'jpg' | 'png' | 'webp' | 'mp4';
      if (body.type === 'video') {
        if (!response.headers.get('content-type')?.startsWith('video/mp4')) throw new Error('Seçili API tamamlanmış MP4 dosyası döndürmedi. Bu bağlantı /videos/generations üzerinden MP4 yanıtı gerektirir.');
        bytes = await readLimitedBytes(response, 100 * 1024 * 1024); mime = 'video/mp4'; extension = 'mp4';
      } else {
        const data = JSON.parse(new TextDecoder().decode(await readLimitedBytes(response, 35 * 1024 * 1024)));
        const image = data.data?.[0];
        if (typeof image?.b64_json === 'string' && image.b64_json.length <= 35 * 1024 * 1024) {
          bytes = Buffer.from(image.b64_json, 'base64');
          mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : Buffer.from(bytes.slice(0, 4)).toString() === 'RIFF' ? 'image/webp' : 'image/png';
        } else if (typeof image?.url === 'string') {
          const imageFile = await readPublicImage(image.url, request.signal); bytes = imageFile.bytes; mime = imageFile.mime;
        } else throw new Error('Seçili API görsel dosyası döndürmedi. Görsel üretim modelini ve erişimini kontrol et.');
        extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
      }
      if (!bytes.length) throw new Error('Üretilen medya dosyası boş.');
      const result = await saveOutput(bytes, extension, mime);
      return NextResponse.json({ success: true, data: { ...result, prompt, provider: connection.name, model: connection.model } });
    }

    const result =
      body.type === 'image'
        ? await generateImage({ ...body, prompt }, key, request.signal)
        : await generateVideo({ ...body, prompt }, key, request.signal);
    return NextResponse.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = modelErrorMessage(error, [key, ...modelSecrets(settings)]);
    return NextResponse.json({ error: message }, { status: error instanceof MediaConfigurationError ? 422 : 500 });
  }
}
