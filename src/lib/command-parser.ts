/**
 * Intelligent Command Parser — Port of Jarvis AI Assistant's command parsing.
 *
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 *   src/services/intelligent-command-parser.ts
 *   src/services/cloud-command-parser.ts
 * License: MIT
 *
 * Chloe already has basic intent parsing in jarvis.test.mjs (intent regex).
 * This module adds Jarvis's layered approach: NLP keyword matching → LLM fallback,
 * parameter extraction, ambiguous command nudge support.
 */

export interface ParsedCommand {
  intent: string;
  entities: Record<string, string>;
  confidence: number;
  needsClarification: boolean;
  clarification: string | null;
}

/**
 * Predefined command patterns ported from Jarvis intent system.
 * These match common voice commands with high precision without requiring an LLM.
 */
export const COMMAND_PATTERNS: Array<{
  intent: string;
  pattern: RegExp;
  entities?: string[];
  confidence: number;
}> = [
  { intent: 'open_app', pattern: /(?:ac|open|launch)\s+(.+?)(?:\s+(?:ac|mukemmel|simdi))?$/i, entities: ['target'], confidence: 0.9 },
  { intent: 'open_browser', pattern: /\b(?:open|visit)\s+(?:https?:\/\/)?([a-z0-9-]+\.[a-z]{2,})\b|^\s*git\s+(github\.com|\w+\.\w+)\s*$/i, entities: ['url'], confidence: 0.95 },
  { intent: 'code_start', pattern: /(?:kod yaz|kodlama yap|coding start|write code|code mode|developer mode)/i, confidence: 0.9 },
  { intent: 'team_start', pattern: /(?:ajan|ekip kalk|kadro|team start)/i, confidence: 0.9 },
  { intent: 'team_stop', pattern: /(?:ekibi durdur|durdur|kanal)/i, confidence: 0.85 },
  { intent: 'search', pattern: /(?:(?:arastir|search|ara|bul)\s+(.+)|(.+)\s+(?:arastir|search|ara|bul))/i, entities: ['query'], confidence: 0.85 },
  { intent: 'report', pattern: /(?:rapor|report|durum raporu|raporu oku)/i, confidence: 0.8 },
  { intent: 'dictation_start', pattern: /(?:konus|basla|dictate|dikte|kayd|record|dictation)/i, confidence: 0.75 },
  { intent: 'dictation_stop', pattern: /(?:bitir|finish|kapat|pause|^\s*dur\s*$)/i, confidence: 0.75 },
  { intent: 'file_edit', pattern: /(?:duzenle|edit|modify|change)/i, entities: ['target'], confidence: 0.85 },
  { intent: 'play_pause', pattern: /(?:oynat|play|pause|muzik|music)/i, confidence: 0.7 },
  { intent: 'volume', pattern: /(?:ses|volume|increase|decrease).*(?:yukselt|azalt|up|down)/i, confidence: 0.7 }
];

const CLARIFICATIONS: Record<string, string> = {
  open_app: 'Hangi uygulamayı açmamı istersein?',
  open_browser: 'Hangi web sitesine gitmemi isterin?',
  search: 'Ne araştırmamı istersin?',
  file_edit: 'Hangi dosyayı düzenlemeliyim?',
};

/**
 * Layer 1: Fast intent parsing using keyword/NLP patterns.
 * No API call required — works entirely offline.
 * Returns high-confidence match or needsClarification flag.
 */
export function parseCommand(text: string): ParsedCommand {
  const trimmed = text.trim().toLowerCase();

  // Try each pattern in order; highest confidence wins
  let best: { intent: string; entities: Record<string, string>; confidence: number } | null = null;

  for (const rule of COMMAND_PATTERNS) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      const entities: Record<string, string> = {};
      if (rule.entities) {
        // Collect all capture groups after the first (group 0 is full match)
        const captured = match.slice(1).filter(s => s !== undefined);
        for (let i = 0; i < rule.entities.length && i < captured.length; i++) {
          entities[rule.entities[i]] = captured[i]?.trim() || '';
        }
      }
      if (!best || rule.confidence > best.confidence) {
        best = { intent: rule.intent, entities, confidence: rule.confidence };
      }
    }
  }

  if (best && best.confidence >= 0.7) {
    return {
      intent: best!.intent,
      entities: best!.entities,
      confidence: best!.confidence,
      needsClarification: false,
      clarification: null,
    };
  }

  // Fallback: generic app open (low confidence)
  if (trimmed.startsWith('aç ') || trimmed.startsWith('open ')) {
    const target = trimmed.replace(/^(aç|open)\s+/, '').trim();
    if (target) {
      return {
        intent: 'open_app',
        entities: { target },
        confidence: 0.5,
        needsClarification: true,
        clarification: `Ne açmamı istiyorsun: "${target}"?`,
      };
    }
  }

  // No match — needs clarification
  return {
    intent: 'unknown',
    entities: {},
    confidence: 0,
    needsClarification: true,
    clarification: CLARIFICATIONS['unknown'] || 'Ne yapmamı istersin?',
  };
}

/**
 * Layer 2: LLM fallback for ambiguous commands.
 * Uses the same pattern as Chloe's existing jarvis/command API route.
 * This is only called when parseCommand returns confidence < 0.6.
 */
export interface LLMClarificationResult {
  intent: string;
  entities: Record<string, string>;
  clarification: string | null;
}

/**
 * Build an LLM prompt for clarifying ambiguous commands.
 * Ported from Jarvis cloud-command-parser pattern.
 */
export function buildClarificationPrompt(text: string): string {
  return `Kullanıcı komutunu anlamaya çalış: "${text}"

Mümkün olan intent tipleri ve açıklamaları:
- open_app: Uygulama veya web sitesi açma (entities: target)
- open_browser: Web sayfası açma (entities: url)
- search: Web araması (entities: query)
- code_start: Kodlama modunu başlat
- file_edit: Dosya düzenleme (entities: target)
- team_start: Ajan ekibi başlat
- team_stop: Ajan ekibini durdur
- report: Rapor/durum isteği
- dictation_start: Dikte başlat
- dictation_stop: Dikte durdur
- play_pause: Medya oynat/dur
- volume: Ses artır/azalt
- unknown: Hiçbiri

Yalnızca JSON çıktı ver: {"intent":"...", "entities":{...}, "clarification":"null veya kısa soru"}
Emin değilsen clarification doldur, intent "unknown" olabilir.`;
}
