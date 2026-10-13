import { NextResponse } from 'next/server';
import { localRequestAllowed } from '@/lib/request-origin';

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
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
      return NextResponse.json(
        { error: 'Tarayıcı yalnızca kullanıcı bilgisi içermeyen HTTP/HTTPS adreslerini açar.' },
        { status: 400 }
      );
    }
    if (body.action === 'read_element' && body.selector !== undefined &&
        (typeof body.selector !== 'string' || body.selector.length > 500)) {
      return NextResponse.json({ error: 'CSS seçicisi geçersiz veya çok uzun.' }, { status: 400 });
    }

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

    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30_000 });

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
