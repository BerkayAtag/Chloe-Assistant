import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';
import { readPublicResource } from '@/lib/public-page';

type BrowserAction = 'navigate' | 'read_page' | 'screenshot' | 'read_element';

const ACTIONS = new Set<BrowserAction>([
  'navigate',
  'read_page',
  'screenshot',
  'read_element',
]);

export async function POST(req: Request) {
  let browser: import('playwright').Browser | undefined;
  try {
    if (!localRequestAllowed(req)) {
      return NextResponse.json({ error: 'Tarayıcı isteği bu uygulamadan yapılmalı.' }, { status: 403 });
    }
    const rawBody = await req.text();
    if (rawBody.length > 16_384) {
      return NextResponse.json({ error: 'Tarayıcı isteği çok büyük.' }, { status: 413 });
    }

    let body: {
      action?: string;
      url?: string;
      selector?: string;
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'İstek gövdesi geçerli JSON olmalı.' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Geçerli bir tarayıcı isteği gerekli.' }, { status: 400 });
    }
    if (!body.action || !ACTIONS.has(body.action as BrowserAction)) {
      return NextResponse.json(
        { error: 'Desteklenmeyen işlem. navigate, read_page, read_element veya screenshot kullan.' },
        { status: 400 }
      );
    }
    if (typeof body.url !== 'string') {
      return NextResponse.json({ error: 'İşlem için bir web adresi gerekli.' }, { status: 400 });
    }

    let url: URL;
    try {
      url = new URL(body.url.trim());
    } catch {
      return NextResponse.json({ error: 'Geçerli bir web adresi gir.' }, { status: 400 });
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443') {
      return NextResponse.json(
        { error: 'Web önizlemesi yalnızca herkese açık HTTPS adreslerini okur. Etkileşimli gezinme için macOS Tarayıcı Yönetimi kullan.' },
        { status: 400 }
      );
    }
    if (body.action === 'read_element' && body.selector !== undefined &&
        (typeof body.selector !== 'string' || body.selector.length > 500)) {
      return NextResponse.json({ error: 'CSS seçicisi geçersiz veya çok uzun.' }, { status: 400 });
    }

    // Validate and pin the top-level document before starting Chromium.
    const document = await readPublicResource(url.href, req.signal);
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch {
      return NextResponse.json(
        { error: 'Tarayıcı otomasyonu bileşeni bulunamadı. Proje klasöründe `npx playwright install chromium` çalıştır.' },
        { status: 503 }
      );
    }

    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'bilinmeyen başlatma hatası';
      return NextResponse.json(
        { error: `Otomasyon tarayıcısı açılamadı (${reason}). Proje klasöründe \`npx playwright install chromium\` çalıştır.` },
        { status: 503 }
      );
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, javaScriptEnabled: false, serviceWorkers: 'block', acceptDownloads: false });
    let requests = 0, bytes = 0;
    await context.route('**/*', async (route) => {
      try {
        if (++requests > 40 || bytes > 20 * 1024 * 1024 || route.request().method() !== 'GET') return await route.abort('blockedbyclient');
        const resource = route.request().url() === document.url ? document : await readPublicResource(route.request().url(), req.signal);
        bytes += resource.bytes.length;
        if (bytes > 20 * 1024 * 1024) return await route.abort('blockedbyclient');
        await route.fulfill({ status: 200, contentType: resource.mime, body: resource.bytes });
      } catch { await route.abort('blockedbyclient').catch(() => {}); }
    });
    const page = await context.newPage();
    await page.goto(document.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    switch (body.action as BrowserAction) {
      case 'navigate':
        return NextResponse.json({ success: true, title: await page.title(), url: page.url() });
      case 'read_page': {
        const content = await page.locator('body').innerText({ timeout: 10_000 });
        return NextResponse.json({
          success: true,
          title: await page.title(),
          url: page.url(),
          content: content.slice(0, 12_000),
        });
      }
      case 'read_element': {
        const selector = body.selector?.trim() || 'body';
        const content = await page.locator(selector).first().innerText({ timeout: 10_000 });
        return NextResponse.json({
          success: true,
          title: await page.title(),
          url: page.url(),
          content: content.slice(0, 8_000),
        });
      }
      case 'screenshot': {
        const buffer = await page.screenshot({ type: 'png', fullPage: false, timeout: 15_000 });
        return new Response(new Uint8Array(buffer), {
          headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
        });
      }
    }
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Tarayıcı işlemi başarısız oldu.' },
      { status: 500 }
    );
  } finally {
    await browser?.close().catch((error: unknown) => {
      console.error('Playwright browser cleanup failed:', error);
    });
  }
}
