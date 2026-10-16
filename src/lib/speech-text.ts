const SENTENCE_PUNCTUATION = /[.!?…;:。！？]/u;

export function cleanSpeechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, ' Kod örneğini ekranda görebilirsin. ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, '')
    .replace(/[*#`_]/g, '').trim();
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
          if (candidate >= 36 && candidate <= 140) { end = candidate; break; }
        }
      }
      for (const match of pending.matchAll(/[.!?…](?=\s)|\n/g)) {
        if (end) break;
        const candidate = match.index! + match[0].length;
        const prefix = pending.slice(0, candidate);
        if (candidate >= 24 && (prefix.match(/```/g)?.length || 0) % 2 === 0) { end = candidate; break; }
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
