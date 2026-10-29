'use client';
import { useCallback, useSyncExternalStore } from 'react';
import { CONNECTION_FIELDS, DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '@/lib/settings';

export type ConnectionStorageStatus = { state: 'loading' | 'saved' | 'saving' | 'error'; message: string };
type Snapshot = { settings: Settings; ready: boolean; storage: ConnectionStorageStatus };
const initial: Snapshot = { settings: DEFAULT_SETTINGS, ready: false, storage: { state: 'loading', message: 'Bağlantı kasası açılıyor…' } };
let snapshot = initial;
let started = false;
let migrated = false;
let revision = 0;
let pending: Partial<Settings> = {};
let flight: Promise<boolean> | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const headers = { 'Content-Type': 'application/json', 'x-chloe-settings': '1' };
const emit = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach((fn) => fn()); };
const connection = (settings: Settings) => Object.fromEntries(CONNECTION_FIELDS.map((field) => [field, settings[field]]));

async function requestVault(action: 'migrate' | 'save', patch: Partial<Settings>) {
  const response = await fetch('/api/settings', { method: 'POST', headers, cache: 'no-store',
    signal: AbortSignal.timeout(10_000), body: JSON.stringify({ action, patch, revision }) });
  // A crashed route returns an HTML/text error page; surface the status, not a JSON parse error.
  const value = await response.json().catch(() => ({ error: `Yerel Chloe sunucusu yanıt veremedi (HTTP ${response.status}). Uygulamayı yeniden başlat.` }));
  if (!response.ok) throw new Error(value.error || 'Bağlantılar kaydedilemedi.');
  return value as { revision: number; connection: Partial<Settings>; recovered: boolean };
}

async function bootstrap() {
  try {
    const value = await requestVault('migrate', connection(snapshot.settings));
    revision = value.revision; migrated = true;
    const settings = { ...snapshot.settings, ...value.connection, ...pending };
    saveSettings(settings, true);
    emit({ settings, ready: true, storage: { state: 'saved', message: value.recovered
      ? 'Bağlantılar şifreli yedekten kurtarıldı.' : 'Şifreli kasada kayıtlı · Web ve masaüstü ortak' } });
    if (Object.keys(pending).length) void flushSettings();
  } catch (error) {
    emit({ ready: true, storage: { state: 'error', message: error instanceof Error ? error.message : 'Kasa açılamadı. Eski kayıtlar korunuyor.' } });
  }
}

/** Explicit Save waits for disk acknowledgement; a failed save never looks successful. */
export async function flushSettings(): Promise<boolean> {
  clearTimeout(timer);
  if (flight) { const ok = await flight; return ok && Object.keys(pending).length ? flushSettings() : ok; }
  if (!migrated) { await bootstrap(); return migrated; }
  if (!Object.keys(pending).length) return snapshot.storage.state !== 'error';
  const patch = pending; pending = {};
  emit({ storage: { state: 'saving', message: 'Şifreli kasaya kaydediliyor…' } });
  flight = (async () => {
    try {
      const value = await requestVault('save', patch);
      revision = value.revision;
      const settings = { ...snapshot.settings, ...value.connection, ...pending };
      saveSettings(settings, true);
      emit({ settings, storage: { state: 'saved', message: 'Şifreli kasada kayıtlı · Web ve masaüstü ortak' } });
      return true;
    } catch (error) {
      pending = { ...patch, ...pending };
      emit({ storage: { state: 'error', message: error instanceof Error ? error.message : 'Kasa kaydı başarısız; yeniden dene.' } });
      return false;
    } finally { flight = null; }
  })();
  const ok = await flight;
  if (ok && Object.keys(pending).length) return flushSettings();
  return ok;
}

export async function retrySettings() {
  if (!migrated) return bootstrap();
  try {
    const response = await fetch('/api/settings', { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Kasa açılamadı.');
    revision = value.revision;
    emit({ settings: { ...snapshot.settings, ...value.connection, ...pending }, storage: { state: 'saved', message: 'Kasa yeniden bağlandı.' } });
    await flushSettings();
  } catch (error) { emit({ storage: { state: 'error', message: error instanceof Error ? error.message : 'Kasa açılamadı.' } }); }
}

function refreshOnFocus() {
  if (!migrated || flight || Object.keys(pending).length) return;
  const before = snapshot.settings;
  void fetch('/api/settings', { headers, cache: 'no-store', signal: AbortSignal.timeout(10_000) })
    .then(async (response) => {
      if (!response.ok) return;
      const value = await response.json();
      if (snapshot.settings !== before || flight || Object.keys(pending).length) return;
      revision = value.revision;
      const settings = { ...snapshot.settings, ...value.connection };
      saveSettings(settings, true); emit({ settings });
    }).catch(() => { /* Existing confirmed settings remain available offline. */ });
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!started) {
    started = true; snapshot = { ...initial, settings: loadSettings() };
    window.addEventListener('focus', refreshOnFocus);
    window.addEventListener('beforeunload', (event) => {
      if (!Object.keys(pending).length && !flight) return;
      event.preventDefault(); event.returnValue = '';
    });
    void bootstrap();
  }
  return () => { listeners.delete(fn); };
}

export function useSettings() {
  const value = useSyncExternalStore(subscribe, () => snapshot, () => initial);
  const setSettings = useCallback((next: Settings | ((prev: Settings) => Settings)) => {
    const previous = snapshot.settings;
    const settings = typeof next === 'function' ? next(previous) : next;
    for (const field of CONNECTION_FIELDS) {
      if (JSON.stringify(previous[field]) !== JSON.stringify(settings[field])) Object.assign(pending, { [field]: settings[field] });
    }
    saveSettings(settings, migrated);
    emit({ settings, ...(Object.keys(pending).length ? { storage: { state: 'saving' as const, message: 'Şifreli kasaya kaydediliyor…' } } : {}) });
    if (migrated && Object.keys(pending).length) {
      clearTimeout(timer); timer = setTimeout(() => { void flushSettings(); }, 300);
    }
  }, []);
  return [value.settings, setSettings, value.ready, value.storage] as const;
}
