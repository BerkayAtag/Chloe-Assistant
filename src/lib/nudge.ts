/**
 * Nudge System — Port of Jarvis AI Assistant's completion nudges
 *
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 *   src/services/user-nudge-service.ts
 * License: MIT
 *
 * Detects incomplete responses (user stopped mid-sentence, partial code,
 * trailing off) and triggers a gentle prompt to continue or clarify.
 */

export interface NudgeContext {
  /** Full text of the last assistant message. */
  text: string;
  /** Whether the message ends abruptly (no terminal punctuation). */
  endsAbruptly: boolean;
  /** Whether a code block is open. */
  hasOpenCodeBlock: boolean;
  /** Whether the user has already responded. */
  hasUserFollowedUp: boolean;
  /** How long to wait before nudging (ms). */
  cooldownMs: number;
}

export interface NudgeTrigger {
  id: string;
  /** Whether a nudge should fire for this context. */
  shouldNudge: (context: NudgeContext) => boolean;
  /** Template for the nudge text to display. */
  template: (context: NudgeContext) => string;
  /** Cooldown before the same trigger can fire again. */
  cooldown: number;
}

/**
 * Default triggers ported from Jarvis's nudge patterns.
 * Each trigger is a pure function — fully testable.
 */
export const DEFAULT_NUDGES: NudgeTrigger[] = [
  {
    id: 'incomplete-sentence',
    cooldown: 10000,
    shouldNudge: (ctx) => {
      if (ctx.hasUserFollowedUp) return false;
      if (ctx.endsAbruptly && ctx.text.split(/\s+/).length > 5) return true;
      return false;
    },
    template: () => 'Cevabin kisitli gibi gorunuyor — devam etmemi ister misin?',
  },
  {
    id: 'open-code-block',
    cooldown: 30000,
    shouldNudge: (ctx) => {
      if (ctx.hasUserFollowedUp) return false;
      if (ctx.hasOpenCodeBlock) return true;
      return false;
    },
    template: () => 'Kod blogu acik — kapatayim mi yoksa baska bir sey istersin?',
  },
  {
    id: 'too-short',
    cooldown: 15000,
    shouldNudge: (ctx) => {
      if (ctx.hasUserFollowedUp) return false;
      if (ctx.endsAbruptly && ctx.text.split(/\s+/).length < 3) return true;
      return false;
    },
    template: () => 'Kisa yanit verdim — daha detayli aciklamam mi istersin?',
  },
];

/**
 * Analyze assistant text and determine if it is incomplete.
 */
export function analyzeText(text: string): {
  endsAbruptly: boolean;
  hasOpenCodeBlock: boolean;
  wordCount: number;
} {
  const trimmed = text.trim();
  const wordCount = trimmed === '' ? 0 : trimmed.split(/\s+/).length;
  if (wordCount === 0) return { endsAbruptly: false, hasOpenCodeBlock: false, wordCount: 0 };
  const endPunct = /[.!?…;:]$/u.test(trimmed);
  const endParenOrQuote = /[\)\]'"“”‘’]$/u.test(trimmed);
  const endsAbruptly = !endPunct && !endParenOrQuote;
  const fenceCount = (text.match(/```/g) || []).length;
  const hasOpenCodeBlock = fenceCount % 2 === 1;
  return { endsAbruptly, hasOpenCodeBlock, wordCount };
}

/**
 * Check all nudge triggers against context.
 * Returns the first matching trigger text, or null.
 */
export function checkNudges(context: NudgeContext, triggerList: NudgeTrigger[] = DEFAULT_NUDGES): { trigger: NudgeTrigger; text: string } | null {
  if (context.hasUserFollowedUp) return null;
  for (const trigger of triggerList) {
    if (trigger.shouldNudge(context)) {
      return { trigger, text: trigger.template(context) };
    }
  }
  return null;
}

/**
 * Build a full NudgeContext from raw text and conversation state.
 */
export function buildNudgeContext(
  lastAssistantText: string,
  hasUserFollowedUp: boolean,
  cooldownMs: number = 10000
): NudgeContext {
  const analysis = analyzeText(lastAssistantText);
  return {
    text: lastAssistantText,
    endsAbruptly: analysis.endsAbruptly,
    hasOpenCodeBlock: analysis.hasOpenCodeBlock,
    hasUserFollowedUp,
    cooldownMs,
  };
}
