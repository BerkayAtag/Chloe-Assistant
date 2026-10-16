import type { OfficeRun } from './office-types';

export type JarvisWorkMode = 'auto' | 'team' | 'browser' | 'computer' | 'report';
export type JarvisCommand = { kind: Exclude<JarvisWorkMode, 'auto'> | 'status' | 'cancel'; prompt: string; requiresWorkspace?: boolean };
const normalize = (value: string) => value.toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
export function jarvisCommand(text: string, mode: JarvisWorkMode = 'auto'): JarvisCommand | null {
  const prompt = text.trim(); const clean = normalize(prompt);
  if (!prompt) return null;
  if (/^(?:ekibi|ajanlari|calismayi|gorevi)\s+(?:durdur|iptal et)[.!]?$/u.test(clean)) return { kind: 'cancel', prompt };
  if (/^(?:(?:ekibin|ajanlarin|calismanin|gorevin|islerin)\s+(?:durumu(?: ne)?|raporu?))|(?:(?:son\s+)?raporu?\s+(?:oku|goster|sun|ver))|(?:durum\s+raporu|ne durumdasin|durum nedir)[?.!]?$/u.test(clean)) return { kind: 'status', prompt };
  if (mode !== 'auto') return { kind: mode, prompt, requiresWorkspace: mode === 'team' };
  if (/\b(?:yapma|yazma|acma|calistirma|degistirme|durdurma)\b/u.test(clean)) return null;
  if (/\b(?:nasil|nedir|ne demek|yapabilir misin)\b/u.test(clean) && !/\blutfen\b/u.test(clean)) return null;
  if (/(?:tarayici|browser|https?:\/\/|\bwww\.|\.[a-z]{2,}\b)/u.test(clean) && /\b(?:ac|git|gir|gez|oku)\b/u.test(clean)) return { kind: 'browser', prompt };
  if (/(?:bilgisayar|terminal|finder|komut)/u.test(clean) && /\b(?:ac|yonet|calistir)\b/u.test(clean)) return { kind: 'computer', prompt };
  if (/(?:kod|yazilim|uygulama|proje|dosya|bug|hatayi|hatalari|fonksiyon)/u.test(clean) && /(?:yaz|gelistir|olustur|duzenle|duzelt|ekle|uygula|yap)/u.test(clean)) return { kind: 'team', prompt, requiresWorkspace: true };
  if (/(?:ekip|ajan)/u.test(clean) && /(?:calistir|yaptir|baslat|arastir|incele)/u.test(clean)) return { kind: 'team', prompt };
  if (/(?:rapor|detayli arastir|kapsamli arastir|derinlemesine)/u.test(clean) && /(?:hazirla|uret|sun|arastir|incele|yap)/u.test(clean)) return { kind: 'report', prompt };
  return null;
}

export function jarvisBrowserUrl(text: string): string {
  const value = text.match(/https?:\/\/[^\s<>"']+|(?:www\.)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?/iu)?.[0]?.replace(/[.,;!?]+$/, '');
  if (!value) throw new Error('Açılacak HTTP/HTTPS adresini belirt. Örnek: example.com sitesini aç.');
  const url = new URL(/^https?:/i.test(value) ? value : `https://${value}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Adres geçersiz.');
  return url.toString();
}

export function officeStatusText(run: OfficeRun | null): string {
  if (!run) return 'Henüz bu JARVIS oturumuna bağlı ekip çalışması yok.';
  const labels = { planning: 'planlanıyor', running: 'çalışıyor', completed: 'tamamlandı', failed: 'hata ile durdu', cancelled: 'iptal edildi', interrupted: 'kesintiye uğradı' };
  const done = run.tasks.filter((task) => task.status === 'completed').length;
  return `Ekip ${labels[run.status]}. ${done}/${run.tasks.length} görev tamamlandı. ${run.artifacts.length} dosya önerisi, ${run.artifacts.filter((a) => a.applied).length} uygulanmış dosya var. ${run.error || ''}`.trim();
}

export function officeReport(run: OfficeRun): string {
  return `# JARVIS çalışma raporu\n\n${officeStatusText(run)}\n\nİstek: ${run.prompt}\nKlasör: ${run.workspace || 'yok'}\n\n${run.result || 'Nihai rapor henüz oluşmadı.'}\n\n## Görevler\n${run.tasks.map((t) => `- ${t.title}: ${t.status}\n${t.error || t.output}`).join('\n\n')}\n\n## Dosyalar\n${run.artifacts.map((a) => `- ${a.path}: ${a.applied ? 'uygulandı' : 'öneri'}; denetim: ${a.review?.verdict || 'yok'}`).join('\n')}\n\nAI incelemesi test çalıştırıldığı anlamına gelmez.\n`;
}
