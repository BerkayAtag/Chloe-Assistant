import { lookup } from 'node:dns/promises';
import https from 'node:https';

function publicAddress(address: string) {
  // IPv6 is deliberately excluded; use a public IPv4 address for this read-only tool.
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return false;
  const [a, b] = parts;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
}

/** Pin the validated DNS address, and validate each redirect before fetching it. */
async function publicBytes(rawUrl: string, contentType: RegExp, maxBytes: number, parentSignal?: AbortSignal, redirects = 0): Promise<{ bytes: Buffer; mime: string }> {
  const url = new URL(rawUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port && url.port !== '443' || redirects > 3) throw new Error('Yalnızca herkese açık HTTPS sayfaları okunabilir.');
  const addresses = await lookup(url.hostname, { all: true, family: 4 });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Yerel ve özel ağ adresleri okunamaz.');
  const selected = addresses[0];
  const signal = AbortSignal.any([...(parentSignal ? [parentSignal] : []), AbortSignal.timeout(12000)]);
  const result = await new Promise<{ location?: string; bytes?: Buffer; mime?: string }>((resolve, reject) => {
    const req = https.get(url, {
      signal, agent: false, family: 4, headers: { 'User-Agent': 'Chloe/1.0', Accept: '*/*' },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) { response.resume(); resolve({ location: response.headers.location }); return; }
      const mime = response.headers['content-type']?.split(';')[0] || '';
      if (response.statusCode !== 200 || !contentType.test(mime)) { response.resume(); reject(new Error(`Dosya türü uygun değil veya indirilemedi (HTTP ${response.statusCode}).`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > maxBytes) response.destroy(new Error('Dosya boyut sınırını aşıyor.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), mime }));
    });
    req.on('error', reject);
  });
  if (result.location) return publicBytes(new URL(result.location, url).href, contentType, maxBytes, signal, redirects + 1);
  if (!result.bytes?.length) throw new Error('İndirilen dosya boş.');
  return { bytes: result.bytes, mime: result.mime || '' };
}

export async function readPublicPage(rawUrl: string, signal?: AbortSignal): Promise<string> {
  const { bytes } = await publicBytes(rawUrl, /^(text\/(html|plain)|application\/xhtml\+xml)$/, 1024 * 1024, signal);
  return bytes.toString('utf8').replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10000);
}

/** Generated remote images are downloaded without forwarding API credentials. */
export function readPublicImage(url: string, signal?: AbortSignal) {
  return publicBytes(url, /^image\/(png|jpeg|webp)$/, 25 * 1024 * 1024, signal);
}
