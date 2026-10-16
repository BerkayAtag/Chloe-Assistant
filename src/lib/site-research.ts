import { PublicPageError, readPublicText } from './public-page.ts';

export interface ResearchPage { url: string; title: string; text: string; fetchedAt: string }
function decode(text: string) {
  return text.replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (m, value: string) => {
    const point = value.toLowerCase().startsWith('x') ? parseInt(value.slice(1), 16) : Number(value);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : m;
  }).replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[m] || m);
}
export function parseResearchPage(html: string, url: string) {
  const clean = html.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const text = decode(clean.replace(/<\/(?:p|div|h[1-6]|li|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n/g, '\n\n').trim().slice(0, 14000);
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]*>/g, '') || new URL(url).hostname).slice(0, 240);
  const links = [...clean.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)].flatMap((m) => {
    try { const u = new URL(decode(m[1]), url); u.hash = ''; if (u.origin !== new URL(url).origin || u.search || u.username || u.password || /\.(pdf|zip|jpg|png|mp4)$/i.test(u.pathname)) return []; return [u.href]; } catch { return []; }
  });
  return { title, text, links: [...new Set(links)].slice(0, 100) };
}

// RFC-style group selection, wildcard paths and longest matching rule. Unknown
// robots/network failures stop the crawl instead of silently ignoring policy.
export function robotsAllows(robots: string, rawUrl: string): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let group = { agents: [] as string[], rules: [] as { allow: boolean; path: string }[] };
  for (const line of robots.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, '').trim().match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const [, rawKey, value] = match; const key = rawKey.trim().toLowerCase();
    if (key === 'user-agent' && value) {
      if (group.rules.length) { groups.push(group); group = { agents: [], rules: [] }; }
      group.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(key) && group.agents.length && value) group.rules.push({ allow: key === 'allow', path: value });
  }
  groups.push(group);
  const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && 'chloe'.includes(a)));
  const rules = (specific.length ? specific : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  const url = new URL(rawUrl); const target = url.pathname + url.search;
  const matches = rules.filter((r) => {
    const end = r.path.endsWith('$'); const path = end ? r.path.slice(0, -1) : r.path;
    const pattern = path.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${pattern}${end ? '$' : ''}`).test(target);
  }).sort((a, b) => b.path.replace(/[*$]/g, '').length - a.path.replace(/[*$]/g, '').length || Number(b.allow) - Number(a.allow));
  return matches[0]?.allow ?? true;
}

export async function crawlSite(rawUrl: string, limit = 4, signal?: AbortSignal, reader = readPublicText) {
  const start = new URL(rawUrl); start.hash = '';
  if (start.protocol !== 'https:' || start.username || start.password || start.search || start.port && start.port !== '443') throw new Error('Sorgu veya kimlik bilgisi içermeyen herkese açık HTTPS adresi gir.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 6) throw new Error('Tarama sınırı 1–6 sayfa olmalı.');
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(65000)]);
  let robots = '';
  try { robots = (await reader(new URL('/robots.txt', start).href, bounded, start.origin)).bytes.toString('utf8'); }
  catch (error) { if (!(error instanceof PublicPageError && error.status === 404)) throw new Error(`robots.txt doğrulanamadı; tarama başlatılmadı. ${error instanceof Error ? error.message : ''}`); }
  const queue = [start.href]; const seen = new Set<string>(); const pages: ResearchPage[] = []; const warnings: string[] = [];
  while (queue.length && pages.length < limit && seen.size < 12) {
    bounded.throwIfAborted(); const url = queue.shift()!;
    if (seen.has(url)) continue; seen.add(url);
    if (!robotsAllows(robots, url)) { warnings.push(`robots.txt nedeniyle atlandı: ${url}`); continue; }
    try {
      const data = await reader(url, bounded, start.origin, (target) => robotsAllows(robots, target));
      if (!robotsAllows(robots, data.url)) throw new Error('Yönlendirilen sayfa robots.txt ile engellenmiş.');
      const parsed = parseResearchPage(data.bytes.toString('utf8'), data.url);
      if (!parsed.text) throw new Error('Okunabilir metin yok; JavaScript ile oluşturulan sayfalar desteklenmiyor.');
      if (!pages.some((p) => p.url === data.url)) pages.push({ url: data.url, title: parsed.title, text: parsed.text, fetchedAt: new Date().toISOString() });
      const useful = parsed.links.sort((a, b) => Number(/about|pricing|product|team|company|news|hakk|fiyat/i.test(b)) - Number(/about|pricing|product|team|company|news|hakk|fiyat/i.test(a)));
      queue.push(...useful.filter((u) => !seen.has(u) && !queue.includes(u)).slice(0, 12));
    } catch (error) { bounded.throwIfAborted(); warnings.push(`${url}: ${error instanceof Error ? error.message : 'Okunamadı'}`); }
  }
  if (!pages.length) throw new Error(`Hiçbir sayfa okunamadı. ${warnings.join(' ').slice(0, 1000)}`);
  return { pages, warnings, markdown: pages.map((p, i) => `## [${i + 1}] ${p.title}\n\nKaynak: ${p.url}\nErişim: ${p.fetchedAt}\n\n${p.text}`).join('\n\n---\n\n') };
}
