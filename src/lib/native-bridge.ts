'use client';

export type NativeAction = 'openBrowser' | 'openMacManagement' | 'openCodex' | 'startDictation' | 'stopDictation' | 'chooseWorkspace';

export interface NativeActionPayload {
  url?: string;
  command?: string;
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        chloeMac?: { postMessage: (message: { action: NativeAction } & NativeActionPayload) => void };
      };
    };
  }
}

export function sendNativeAction(action: NativeAction, payload: NativeActionPayload = {}): boolean {
  if (typeof window === 'undefined') return false;
  const handler = window.webkit?.messageHandlers?.chloeMac;
  if (!handler) return false;
  handler.postMessage({ action, ...payload });
  return true;
}
