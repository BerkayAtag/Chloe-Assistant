import type { Settings } from './settings';

// FreeLLMAPI's `auto:fast` router sometimes lands on a slow or reasoning model
// (measured 4–7 s, occasionally 502), while flash-lite families answer in
// ~0.5–1.2 s. Voice turns prefer the first of these the gateway lists as available.
const PREFERRED = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite', 'gemini-2.5-flash-lite'];
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; model: string | null }>();

async function listedFastModel(baseUrl: string, apiKey: string): Promise<string | null> {
  const key = `${baseUrl}\n${apiKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.model;
  let model: string | null = null;
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(1500), cache: 'no-store',
    });
    if (response.ok) {
      const rows = ((await response.json()) as { data?: { id?: string; available?: boolean }[] }).data || [];
      const available = new Set(rows.filter((row) => row.id && row.available !== false).map((row) => row.id));
      model = PREFERRED.find((id) => available.has(id)) || null;
    }
  } catch { /* keep auto:fast */ }
  cache.set(key, { at: Date.now(), model });
  return model;
}

/** Swaps FreeLLMAPI's `auto:fast` voice route for a listed flash-lite model. */
export async function preferFastVoiceModel(settings: Settings): Promise<Settings> {
  if (settings.customModel !== 'auto:fast' || !settings.apiKey) return settings;
  const model = await listedFastModel(settings.apiBaseUrl, settings.apiKey);
  return model ? { ...settings, customModel: model } : settings;
}
