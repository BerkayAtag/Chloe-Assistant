export type JarvisEvent =
  | { type: 'text'; text: string }
  | { type: 'meta'; connection: string; contextChars: number }
  | { type: 'routing'; servedModel: string }
  | { type: 'timing'; firstTokenMs: number | null; totalMs: number }
  | { type: 'error'; message: string }
  | { type: 'done' };

export class JarvisEventDecoder {
  private pending = '';
  push(text: string, final = false): JarvisEvent[] {
    this.pending += text;
    const lines = this.pending.split('\n');
    this.pending = final ? '' : lines.pop()!;
    if (this.pending.length > 128000) throw new Error('Yanıt akışı boyut sınırını aştı.');
    return lines.filter((line) => line.trim()).map((line) => JSON.parse(line) as JarvisEvent);
  }
}

export function safeRoutedModel(value: string | null): string | null {
  return value && /^[\w./:+ -]{1,160}$/.test(value) ? value : null;
}
