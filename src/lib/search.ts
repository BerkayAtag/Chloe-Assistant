import { readPublicPage } from './public-page';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(str: string): string {
  return decodeEntities(str.replace(/<[^>]+>/g, '')).trim();
}

/**
 * DuckDuckGo HTML uç noktası üzerinden (anahtarsız) web araması.
 */
export async function searchWeb(query: string, limit = 5, signal?: AbortSignal): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
    },
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12000)]),
  });

  if (!response.ok) {
    throw new Error(`Arama başarısız (${response.status})`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // DDG HTML sonuç kalıbı: result__a (başlık+link) ve result__snippet
  const blockRe =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let m;
  while ((m = blockRe.exec(html)) !== null && results.length < limit) {
    const rawUrl = decodeEntities(m[1]);
    const title = stripTags(m[2]);
    const snippet = stripTags(m[3]);

    let realUrl = rawUrl;
    try {
      // DuckDuckGo bazı sonuçları protokol-göreli ve HTML entity'li döndürür.
      // Bunları normalize etmeden kaydetmek, araştırma kaynaklarını bozuk bırakıyordu.
      const u = new URL(rawUrl, 'https://duckduckgo.com');
      const uddg = u.searchParams.get('uddg');
      if (uddg) realUrl = decodeURIComponent(uddg);
      else realUrl = u.toString();
    } catch {
      /* boş bırak */
    }

    if (title && realUrl) {
      results.push({ title, url: realUrl, snippet });
    }
  }

  return results;
}

export interface ImageResult {
  url: string;
  title?: string;
}

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/**
 * İnternette görsel arar (anahtarsız). Önce Bing görsel aramasını kazır,
 * olmazsa DuckDuckGo görsel sonuçlarına düşer. Görsel URL'leri döndürür.
 */
export async function searchImages(query: string, limit = 8): Promise<ImageResult[]> {
  const results: ImageResult[] = [];

  // 1) Bing görsel araması
  try {
    const bingUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2`;
    const res = await fetch(bingUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (res.ok) {
      const html = await res.text();
      const re = /murl&quot;:&quot;(.*?)&quot;/g;
      let m;
      while ((m = re.exec(html)) !== null && results.length < limit) {
        const url = decodeEntities(m[1]);
        if (/^https?:\/\//i.test(url) && !results.some((r) => r.url === url)) {
          results.push({ url });
        }
      }
    }
  } catch {
    /* devam */
  }

  // 2) DuckDuckGo görsel araması (yedek)
  if (results.length === 0) {
    try {
      const home = await fetch(`https://duckduckgo.com/?q=${encodeURIComponent(query)}&iax=images&ia=images`, {
        headers: { 'User-Agent': BROWSER_UA },
      });
      const homeHtml = await home.text();
      const vqdMatch = homeHtml.match(/vqd=["']([0-9-]{6,})["']/);
      if (vqdMatch) {
        const ijs = await fetch(
          `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(query)}&vqd=${vqdMatch[1]}`,
          {
            headers: {
              'User-Agent': BROWSER_UA,
              Referer: 'https://duckduckgo.com/',
            },
          }
        );
        if (ijs.ok) {
          const data = await ijs.json();
          for (const item of data.results || []) {
            if (item?.image && results.length < limit) {
              results.push({ url: item.image, title: item.title });
            }
          }
        }
      }
    } catch {
      /* devam */
    }
  }

  return results;
}

/** Verilen URL'den görsel indirir; içerik türü ve boyut doğrulaması yapar. */
export async function downloadImage(
  rawUrl: string,
  maxBytes = 8 * 1024 * 1024
): Promise<{ buffer: Buffer; contentType: string }> {
  let url = rawUrl;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const res = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'image/*' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Görsel indirilemedi (HTTP ${res.status})`);

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\//.test(contentType)) {
    throw new Error(`Kaynak bir görsel değil (içerik türü: ${contentType || 'bilinmiyor'})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error('İndirilen dosya boş.');
  if (buffer.length > maxBytes) {
    throw new Error(`Görsel çok büyük (${(buffer.length / 1024 / 1024).toFixed(1)} MB, üst sınır ${maxBytes / 1024 / 1024} MB).`);
  }

  return { buffer, contentType };
}

/**
 * Sayfanın metin içeriğini çeker (HTML etiketlerini ayıklar).
 * JavaScript gerektiren karmaşık sayfalar için sınırlıdır; tarayıcı
 * otomasyonu için `/api/browser` rotası kullanılmalıdır.
 */
export async function fetchPageText(rawUrl: string, maxChars = 8000, signal?: AbortSignal): Promise<string> {
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  return (await readPublicPage(url, signal)).slice(0, maxChars);
}
