import type { SharedV4ProviderOptions } from '@ai-sdk/provider';
import type { Settings } from './settings';

export function thinkingOptions(settings: Settings): SharedV4ProviderOptions | undefined {
  if (settings.provider !== 'cloud') return undefined;
  const mode = ['fast', 'medium', 'high'].includes(settings.thinkingMode) ? settings.thinkingMode : 'medium';
  if (settings.cloudProvider === 'gemini') {
    if (/^gemini-3(?:[.-]|$)/i.test(settings.cloudModel)) {
      return { google: { thinkingLevel: mode === 'fast' ? 'low' : mode, store: false } };
    }
    if (/^gemini-2\.5(?:[.-]|$)/i.test(settings.cloudModel)) {
      return { google: { thinkingBudget: mode === 'fast' ? 0 : mode === 'medium' ? 8192 : 24576, store: false } };
    }
    return undefined;
  }
  if (settings.cloudProvider === 'openai' && /^(?:o[134](?:-|$)|gpt-5(?:-|$))/i.test(settings.cloudModel)) {
    return { openai: { reasoningEffort: mode === 'fast' ? 'low' : mode } };
  }
  if (settings.cloudProvider === 'anthropic' && /^claude-(?:3-7|sonnet-4|opus-4)/i.test(settings.cloudModel)) {
    if (mode === 'fast') return { anthropic: { thinking: { type: 'disabled' } } };
    return { anthropic: { thinking: { type: 'enabled', budgetTokens: mode === 'medium' ? 4096 : 10000 } } };
  }
  return undefined;
}

export function thinkingOutputTokenLimit(settings: Settings, requested: number) {
  if (settings.provider === 'cloud' && settings.cloudProvider === 'anthropic' &&
      /^claude-(?:3-7|sonnet-4|opus-4)/i.test(settings.cloudModel)) {
    if (settings.thinkingMode === 'medium') return Math.max(requested, 5120);
    if (settings.thinkingMode === 'high') return Math.max(requested, 11000);
  }
  return requested;
}
