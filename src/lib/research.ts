import { searchWeb, fetchPageText } from './search';
import { addExpertise } from './knowledge';

export interface ResearchResult {
  topic: string;
  summary: string;
  sources: string[];
}

/**
 * Bir konuda derin/yoğun araştırma yapar:
 * 1) Birçok farklı arama sorgusu çalıştırır (8 sorguya kadar),
 * 2) En alakalı sayfaların içeriğini çeker (10 sayfaya kadar),
 * 3) `summarize` callback'i (LLM) ile kapsamlı, yapılandırılmış bir
 *    uzmanlık notu üretir,
 * 4) Notu kalıcı bilgi bankasına kaydeder.
 */
export async function deepResearch(
  topic: string,
  summarize: (notes: string, topic: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<ResearchResult> {
  const queries = [
    topic,
    `${topic} nedir`,
    `${topic} temel kavramlar`,
    `${topic} nasıl çalışır`,
    `${topic} tarihçe gelişim`,
    `${topic} örnekler kullanım alanları`,
    `${topic} avantajlar dezavantajlar`,
    `${topic} güncel durum 2025 2026`,
  ];

  const seen = new Map<string, { title: string; url: string; snippet: string }>();

  // 1) Çok sorgulu arama — kaynak havuzunu genişlet
  for (const q of queries) {
    signal?.throwIfAborted();
    let results;
    try {
      results = await searchWeb(q, 5, signal);
    } catch {
      continue;
    }
    for (const r of results) {
      if (!seen.has(r.url)) seen.set(r.url, r);
    }
    if (seen.size >= 12) break;
  }

  const top = [...seen.values()].slice(0, 10);

  // 2) En alakalı sayfaların içeriğini çek
  const pages: { url: string; text: string }[] = [];
  await Promise.all(
    top.map(async (r) => {
      try {
        const text = await fetchPageText(r.url, 6000, signal);
        if (text && text.length > 80) pages.push({ url: r.url, text });
      } catch {
        /* sayfa okunamadı → atla */
      }
    })
  );

  signal?.throwIfAborted();
  const sources = pages.length ? pages.map((p) => p.url) : top.map((r) => r.url);

  // 3) Toplanan notları birleştir
  const notes = pages
    .map((p, i) => `[Kaynak ${i + 1}] ${p.url}\n${p.text}`)
    .join('\n\n');

  const fallbackNotes = top
    .map((r) => `- ${r.title} (${r.url}): ${r.snippet}`)
    .join('\n');

  const combined = notes || fallbackNotes || '';

  // 4) LLM ile kapsamlı uzmanlık notu üret
  if (!combined.trim()) throw new Error('Araştırmada erişilebilir kaynak bulunamadı; bilgi bankasına boş not kaydedilmedi.');
  const summary = await summarize(combined, topic);
  signal?.throwIfAborted();
  if (!summary.trim()) throw new Error('Araştırma özeti boş döndü; bilgi bankasına kaydedilmedi.');

  // 5) Bilgi bankasına kalıcı kaydet
  addExpertise(topic, summary, sources);

  return { topic, summary, sources };
}
