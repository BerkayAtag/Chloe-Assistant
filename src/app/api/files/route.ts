import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { readZipEntry } from '@/lib/zip-entry';

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const execFileAsync = promisify(execFile);

async function extractText(filePath: string, mimeType: string): Promise<string> {
  try {
    if (mimeType === 'application/pdf') {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: await readFile(filePath) });
      try {
        const result = await parser.getText();
        return result.text.trim().slice(0, 120_000);
      } finally { await parser.destroy(); }
    }
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const stdout = readZipEntry(await readFile(filePath), 'word/document.xml', 8 * 1024 * 1024).toString('utf8');
      return stdout
        .replace(/<w:tab\s*\/?>/giu, '\t')
        .replace(/<w:br\s*\/?>/giu, '\n')
        .replace(/<\/w:p>/giu, '\n')
        .replace(/<[^>]+>/gu, '')
        .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&amp;/gu, '&')
        .replace(/\s+\n/gu, '\n').trim().slice(0, 120_000);
    }
    if (mimeType === 'application/msword') {
      if (process.platform !== 'darwin') throw new Error('Eski .doc biçimi yalnız macOS üzerinde okunabiliyor; belgeyi .docx olarak kaydedip yükle.');
      const { stdout } = await execFileAsync('textutil', ['-convert', 'txt', '-stdout', filePath], { maxBuffer: 2 * 1024 * 1024, timeout: 15000 });
      return stdout.trim().slice(0, 120_000);
    }
  } catch (error) {
    throw new Error(`Belge metni okunamadı: ${error instanceof Error ? error.message : 'bilinmeyen hata'}`);
  }
  return '';
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const item = form.get('file');
    if (!(item instanceof File)) return NextResponse.json({ error: 'Dosya bulunamadı.' }, { status: 400 });
    if (!ALLOWED_TYPES.has(item.type)) return NextResponse.json({ error: 'PDF, Word veya görsel yükleyebilirsin.' }, { status: 415 });
    if (item.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'Dosya boyutu en fazla 50 MB olabilir.' }, { status: 413 });
    const id = randomUUID();
    const safeName = item.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'upload';
    const dir = path.join(process.cwd(), 'data', 'uploads');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storedPath = path.join(dir, id + '-' + safeName);
    await writeFile(storedPath, Buffer.from(await item.arrayBuffer()), { mode: 0o600 });
    let extractedText = '';
    let warning: string | undefined;
    try { extractedText = await extractText(storedPath, item.type); } catch (error) {
      warning = error instanceof Error ? error.message : 'Belge metni okunamadı.';
    }
    if (!extractedText && !item.type.startsWith('image/') && !warning) {
      warning = 'Belgede okunabilir metin bulunamadı. Taranmış PDF için OCR gerekebilir.';
    }
    const dataUrl = item.type.startsWith('image/') && item.size <= 12 * 1024 * 1024
      ? 'data:' + item.type + ';base64,' + Buffer.from(await item.arrayBuffer()).toString('base64') : undefined;
    return NextResponse.json({ success: true, data: { id, name: item.name, mimeType: item.type, size: item.size, url: '/api/files/' + id, extractedText, dataUrl, warning } });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Dosya yüklenemedi.' }, { status: 500 });
  }
}
