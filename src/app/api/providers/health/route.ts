import { NextResponse } from 'next/server';
import { DEFAULT_SETTINGS, hasExplicitConnection, type Settings } from '@/lib/settings';
import { localRequestAllowed } from '@/lib/request-origin';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { readLimitedBytes } from '@/lib/media-provider';

/**
 * FreeLLMAPI tarzı uç noktaların sağlık ve kota durumunu bildirir.
 * Kullanılan uçlar FreeLLMAPI'de proxy rate limiter'ının ÖNÜNDE mount edilmiştir:
 *   GET {origin}/livez           (kimlik gerekmez)
 *   GET {origin}/readyz          (kimlik gerekmez)
 *   GET {base}/providers         (unified key)
 *   GET {base}/quota-forecast    (unified key)
 * Diğer sağlayıcılarda bu uçlar yoktur; `supported: false` döner ve hata gösterilmez.
 */

interface ProviderRow {
  platform: string;
  name: string;
  status: string;
  keys: number;
  resumeAt: string | null;
  requestsRemainingPct: number | null;
  lastError: string | null;
}

function isFreeLlmLike(settings: Settings, host: string, name: string): boolean {
  return /freellm/i.test(name) || /freellm/i.test(host);
}

async function jsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const bytes = await readLimitedBytes(response, 1024 * 1024);
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  if (!localRequestAllowed(request)) {
    return NextResponse.json({ error: 'Sağlık kontrolü Chloe içinden istenmeli.' }, { status: 403 });
  }
  let settings = DEFAULT_SETTINGS;
  try {
    const body = await request.json();
    if (!hasExplicitConnection(body?.settings)) throw new Error('Önce sağlayıcı seç.');
    settings = { ...DEFAULT_SETTINGS, ...body.settings } as Settings;
    if (settings.provider !== 'cloud' || settings.cloudProvider !== 'custom') {
      return NextResponse.json({ supported: false, reason: 'Sağlık paneli yalnız OpenAI uyumlu özel uç noktalar (FreeLLMAPI) için kullanılabilir.' });
    }
    const key = settings.apiKey.trim();
    if (!key) throw new Error('Önce kayıtlı API anahtarını seç.');

    const base = new URL(settings.apiBaseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
      throw new Error('API adresi geçersiz.');
    }
    const origin = base.origin;
    const supported = isFreeLlmLike(settings, base.hostname, settings.customProviderName);
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(8000)]);
    const authHeaders = { Authorization: `Bearer ${key}` };

    // 1) Kimliksiz canlılık uçları
    let live: { ok: boolean; status: number; uptimeSeconds: number | null } | null = null;
    let ready: { ok: boolean; status: number; readyUpstreams: number | null } | null = null;
    if (supported) {
      try {
        const response = await fetch(`${origin}/livez`, { redirect: 'error', cache: 'no-store', signal });
        const data = await jsonSafe(response);
        live = { ok: response.ok, status: response.status, uptimeSeconds: typeof data?.uptime_s === 'number' ? data.uptime_s : null };
      } catch { live = null; }
      try {
        const response = await fetch(`${origin}/readyz`, { redirect: 'error', cache: 'no-store', signal });
        const data = await jsonSafe(response);
        ready = { ok: response.ok, status: response.status, readyUpstreams: typeof data?.ready_upstreams === 'number' ? data.ready_upstreams : null };
      } catch { ready = null; }
    }

    // 2) Sağlayıcı durumu
    let providers: ProviderRow[] = [];
    let counts: Record<string, number> = {};
    let keyRejected = false;
    if (supported) {
      const url = new URL(base.toString().replace(/\/+$/, '') + '/providers');
      const response = await fetch(url, { headers: authHeaders, redirect: 'error', cache: 'no-store', signal });
      if (response.status === 401 || response.status === 403) keyRejected = true;
      const data = await jsonSafe(response);
      if (response.ok && Array.isArray(data?.providers)) {
        providers = (data.providers as Record<string, unknown>[]).slice(0, 40).map((row) => ({
          platform: typeof row.platform === 'string' ? row.platform : '—',
          name: typeof row.name === 'string' ? row.name : '—',
          status: typeof row.status === 'string' ? row.status : 'unknown',
          keys: typeof row.keys === 'number' ? row.keys : 0,
          resumeAt: typeof row.resume_at === 'string' ? row.resume_at : null,
          requestsRemainingPct: typeof row.requests_remaining_pct === 'number' ? row.requests_remaining_pct : null,
          lastError: typeof row.last_error === 'string' ? row.last_error.slice(0, 160) : null,
        }));
        if (data.counts && typeof data.counts === 'object') counts = data.counts as Record<string, number>;
      }
    }

    // 3) Kota tahmini
    let quota: { lowBalance: boolean; pools: number; secondsUntilReset: number | null } | null = null;
    if (supported) {
      try {
        const url = new URL(base.toString().replace(/\/+$/, '') + '/quota-forecast');
        const response = await fetch(url, { headers: authHeaders, redirect: 'error', cache: 'no-store', signal });
        const data = await jsonSafe(response);
        if (response.ok && data) {
          const pools = Array.isArray(data.pools) ? data.pools.length : 0;
          const resets = Array.isArray(data.pools)
            ? (data.pools as Record<string, unknown>[])
                .map((pool) => (typeof pool.seconds_until_reset === 'number' ? pool.seconds_until_reset : null))
                .filter((value): value is number => value !== null)
            : [];
          quota = {
            lowBalance: Boolean(data.low_balance) || (Array.isArray(data.pools) && (data.pools as Record<string, unknown>[]).some((pool) => pool.low_balance === true)),
            pools,
            secondsUntilReset: resets.length ? Math.min(...resets) : null,
          };
        }
      } catch { quota = null; }
    }

    return NextResponse.json({ supported, live, ready, providers, counts, quota, keyRejected, checkedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: modelErrorMessage(error, modelSecrets(settings)) }, { status: 502 });
  }
}
