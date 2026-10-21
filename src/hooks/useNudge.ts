'use client';
import { useEffect, useState, useCallback } from 'react';

/**
 * useNudge — Checks if a follow-up nudge should be displayed after an assistant message.
 *
 * Ported from Jarvis AI Assistant's user-nudge-service.ts
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 *
 * @param assistantText - full text of last assistant message
 * @param onNudge - callback when a nudge is detected
 */
export function useNudge(
  assistantText: string,
  options?: { cooldownMs?: number; onNudge?: (text: string) => void }
) {
  const [nudgeText, setNudgeText] = useState<string | null>(null);
  const [lastText, setLastText] = useState('');

  useEffect(() => {
    if (!assistantText || assistantText === lastText) return;
    (async () => {
      try {
        const res = await fetch('/api/nudge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assistantText }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.nudge?.text) {
          const text = data.nudge.text;
          setNudgeText(text);
          setLastText(assistantText);
          options?.onNudge?.(text);
          setTimeout(() => setNudgeText(null), data.nudge.cooldown || 10000);
        }
      } catch {
        /* network error → no nudge */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantText]);

  const dismiss = useCallback(() => {
    setNudgeText(null);
    setLastText(assistantText);
  }, [assistantText]);

  return { nudgeText, dismiss };
}
