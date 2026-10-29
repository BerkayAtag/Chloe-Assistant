'use client';
import { useSyncExternalStore } from 'react';

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
  if (!handler) return action === 'chooseWorkspace' && chooseWorkspaceViaServer();
  handler.postMessage({ action, ...payload });
  return true;
}

// Windows has no WebKit bridge: the local server opens the system folder dialog
// and the result is delivered through the same event the macOS app dispatches.
function chooseWorkspaceViaServer(): boolean {
  if (!/Windows/u.test(navigator.userAgent)) return false;
  const deliver = (path = '') => window.dispatchEvent(new CustomEvent('chloeWorkspace', { detail: { path } }));
  void fetch('/api/local/folder', { method: 'POST', headers: { 'X-Chloe-Client': 'workspace' } })
    .then((response) => response.ok ? response.json() as Promise<{ path?: string }> : {})
    .then((result: { path?: string }) => deliver(result.path))
    .catch(() => deliver());
  return true;
}

const noSubscription = () => () => {};

/** True only inside the macOS app, whose WebKit bridge runs computer management. */
export function useNativeMac(): boolean {
  return useSyncExternalStore(noSubscription, () => Boolean(window.webkit?.messageHandlers?.chloeMac), () => false);
}
