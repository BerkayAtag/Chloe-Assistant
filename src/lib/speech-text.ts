const SENTENCE_PUNCTUATION = /[.!?…;:。！？]/u;

/**
 * Metni sesli okumaya uygun hâle getirir: kod blokları, bağlantılar, tablo
 * çizgileri, emoji ve biçimlendirme işaretleri temizlenir. Ses motorları bu
 * öğeleri ya anlamsız okur ya da okumayı bozar.
 */
export function cleanSpeechText(text: string): string {
  return text
    // Kod blokları: yalnızca kısa bir bilgilendirme cümlesi kalsın.
    .replace(/```[\s\S]*?```/g, ' Kod örneğini ekranda görebilirsin. ')
    // Satır içi kod işaretleri ve HTML etiketleri
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>\n]{1,120}>/g, ' ')
    // Markdown bağlantı/görsel sözdizimi → yalnız metin kalır
    .replace(/!?\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    // Tablo ayırıcı satırları (|---|---|) tamamen atılır, diğer borular boşluğa döner
    .replace(/^\s*\|?[\s:|-]{6,}\|?\s*$/gm, ' ')
    .replace(/\|/g, ' ')
    // Yatay çizgiler ve alıntı işaretleri
    .replace(/^\s*([-*_]\s*){3,}$/gm, ' ')
    .replace(/^\s{0,3}>\s?/gm, '')
    // Madde imleri ve numaralandırma ("- ", "* ", "1. ") okunmasın
    .replace(/^\s{0,6}(?:[-*•]\s+|\d{1,3}[.)]\s+)/gm, '')
    // Emoji ve semboller
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{20E3}]/gu, '')
    // Biçimlendirme işaretleri
    .replace(/[*#_~^]/g, '')
    // Boşluk düzeni: satır sonları cümle aralığına dönüşür
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n+\s*/g, ' ')
    .replace(/\s+([.!?,;:])/g, '$1')
    .trim();
}

/**
 * Apply Jarvis dictation cleaning rules to text. Preserves signatures while
 * cleaning fillers, homophones, and converting spoken file extensions/emojis.
 *
 * Ported from jarvis-ai-assistant: src/prompts/prompts.ts
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant (MIT)
 */
export function jarvisDictationClean(text: string): string {
  return text
    // Remove filler words
    .replace(/^\s*(um|uh|ah|er|like)\s+/gi, '')
    .replace(/\s+(um|uh|ah|er)\s+/gi, ' ')
    // Fix common homophones in dictation context
    .replace(/\btheir is\b/gi, "they're")
    .replace(/\bwrite to\b/gi, 'right to')
    // File extension conversions: "readme dot md" → "readme.md"
    .replace(/\b(\w+)\s+dot\s+(\w+)\b/gi, '$1.$2')
    // Spoken emoji conversion
    .replace(/\bfire emoji\b/gi, '🔥')
    .replace(/\bthumbs up emoji\b/gi, '👍')
    .replace(/\bheart emoji\b/gi, '❤️')
    .replace(/\bsmiling face\b/gi, '😊')
    .trim();
}

/** Keep incomplete words and fenced code until a safe speech boundary exists. */
export function createSpeechTextBuffer(emit: (text: string) => void) {
  let pending = '', emitted = false;
  const drain = (final: boolean) => {
    while (pending) {
      let end = 0;
      // A natural first clause can start TTS while the rest of a long opening
      // sentence is still being generated. Later clips keep sentence cadence.
      if (!emitted && !pending.includes('```')) {
        const clause = /[,;:—](?=\s)/gu;
        for (const match of pending.matchAll(clause)) {
          const candidate = match.index! + match[0].length;
          if (candidate >= 24 && candidate <= 140) { end = candidate; break; }
        }
      }
      for (const match of pending.matchAll(/[.!?…](?=\s)|\n/g)) {
        if (end) break;
        const candidate = match.index! + match[0].length;
        const prefix = pending.slice(0, candidate);
        // A complete short opening ("Merhaba!") must not wait for the entire
        // response. Keep abbreviation/list prefixes and unfinished code intact.
        const shortOpening = !emitted && candidate >= 3 && /[!?…]$/u.test(prefix.trim());
        if ((candidate >= 24 || shortOpening) && (prefix.match(/```/g)?.length || 0) % 2 === 0) { end = candidate; break; }
      }
      if (!end && pending.length > 500 && !pending.includes('```')) end = pending.lastIndexOf(' ', 500);
      if (!end && !final) break;
      if (!end) end = pending.length;
      const raw = pending.slice(0, end);
      pending = pending.slice(end).trimStart();
      const clean = cleanSpeechText(final ? raw.replace(/```[^]*$/g, (code) => (code.match(/```/g)?.length || 0) % 2 ? ' Kod ekranda.' : code) : raw);
      if (clean) { emitted = true; emit(clean); }
    }
  };
  return { push(delta: string) { pending += delta; drain(false); }, finish() { drain(true); } };
}

export function splitSpeechText(text: string, maxLength = 3500): string[] {
  if (!Number.isInteger(maxLength) || maxLength < 1) {
    throw new RangeError('Speech chunk length must be a positive integer.');
  }

  const characters = Array.from(text.trim());
  const chunks: string[] = [];
  let offset = 0;

  while (offset < characters.length) {
    const remaining = characters.length - offset;
    if (remaining <= maxLength) {
      const last = characters.slice(offset).join('').trim();
      if (last) chunks.push(last);
      break;
    }

    let boundary = -1;
    let whitespaceBoundary = -1;
    const segment = characters.slice(offset, offset + maxLength);
    const minimumBoundary = Math.max(1, Math.floor(maxLength * 0.55));
    for (let end = maxLength; end >= minimumBoundary; end -= 1) {
      const character = segment[end - 1];
      const nextCharacter = segment[end];
      if (SENTENCE_PUNCTUATION.test(character) && (end === segment.length || /\s/u.test(nextCharacter || ''))) {
        boundary = end;
        break;
      }
      if (whitespaceBoundary < 0 && /\s/u.test(character || '')) {
        whitespaceBoundary = end;
      }
    }
    if (boundary < 0) boundary = whitespaceBoundary;
    if (boundary < 0) boundary = maxLength;

    const chunk = characters.slice(offset, offset + boundary).join('').trim();
    if (chunk) chunks.push(chunk);
    offset += boundary;
    while (offset < characters.length && /\s/u.test(characters[offset])) offset += 1;
  }

  return chunks;
}
