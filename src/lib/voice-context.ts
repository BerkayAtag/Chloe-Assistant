/** Bound old voice-turn history without truncating the current instruction or
 * separating attachments from their message. Stored conversations are intact. */
export function voiceContext<T extends { content: string }>(messages: T[], budget = 8000): T[] {
  if (!messages.length) return [];
  const latest = messages[messages.length - 1];
  const kept = [latest];
  let used = latest.content.length;
  for (let i = messages.length - 2; i >= Math.max(0, messages.length - 8); i--) {
    const message = messages[i];
    if (used + message.content.length > budget) break;
    kept.unshift(message);
    used += message.content.length;
  }
  return kept;
}
