const SENTENCE_PUNCTUATION = /[.!?…;:。！？]/u;

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
