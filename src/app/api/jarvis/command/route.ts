import { generateText, Output } from 'ai';
import { NextResponse } from 'next/server';
import { getProvider } from '@/lib/llm-provider';
import { DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { localRequestAllowed } from '@/lib/request-origin';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { thinkingOptions } from '@/lib/thinking-options';
import { parseCommand } from '@/lib/command-parser';

export const maxDuration = 65;
export async function POST(request: Request) {
  let settings: Settings = DEFAULT_SETTINGS;
  if (!localRequestAllowed(request)) return NextResponse.json({ error: 'Yerel Chloe isteği gerekli.' }, { status: 403 });
  try {
    const raw = await request.text(); if (raw.length > 64000) throw new Error('İstek çok büyük.');
    const body = JSON.parse(raw);
    if (!hasExplicitConnection(body.settings) || typeof body.instruction !== 'string' || !body.instruction.trim() || body.instruction.length > 4000) throw new Error('Geçerli komut isteği ve etkin model bağlantısı gerekli.');
    settings = { ...DEFAULT_SETTINGS, ...body.settings, thinkingMode: 'fast' };

    // ── Layer 1: Fast offline command parsing (ported from Jarvis) ────────────
    const parsed = parseCommand(body.instruction);
    // The consumer requires an executable proposal plus explanation. An intent
    // alone is not a completed command and must not return null draft fields.

    // ── Layer 2: LLM fallback for ambiguous commands ────────────────────────
    const result = await generateText({ model: getProvider(settings), output: Output.json(), maxRetries: 0, maxOutputTokens: 1000, providerOptions: thinkingOptions(settings),
      abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(60000)]),
      system: 'macOS için bir komut ÖNERİSİ hazırla; hiçbir araç veya yürütme yetkin yok. Yalnız JSON: {"command":"tek satır zsh komutu","explanation":"Türkçe etki ve risk açıklaması"}. İsteğin belirsizse command boş olsun, explanation içinde soru sor. Silme, kimlik bilgisi okuma, izin/güvenlik ayarı değiştirme, sudo, uzak betik indirip çalıştırma veya dışarı veri gönderme isteminde command boş bırakıp kullanıcıya bu arayüzün bunları otomatik yapmadığını açıkla. Basit uygulama açmada /usr/bin/open kullan. Çalıştırdığını iddia etme.',
      prompt: body.instruction,
    });
    let data;
    try { data = JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/u, '').replace(/\s*```$/u, '')); }
    catch { throw new Error('Model geçerli komut önerisi vermedi. Hiçbir komut çalıştırılmadı.'); }
    if (typeof data.command !== 'string' || typeof data.explanation !== 'string' || !data.command.trim()) throw new Error(typeof data.explanation === 'string' ? data.explanation.slice(0, 2000) : 'Model komut üretemedi.');
    if (data.command.length > 2000 || /[\r\n\x00-\x1f]/u.test(data.command)) throw new Error('Komut biçimi geçersiz. Hiçbir komut çalıştırılmadı.');
    return NextResponse.json({ intent: parsed.intent, entities: parsed.entities, command: data.command, explanation: data.explanation.slice(0, 3000) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return NextResponse.json({ error: modelErrorMessage(error, modelSecrets(settings)) }, { status: 400 }); }
}
