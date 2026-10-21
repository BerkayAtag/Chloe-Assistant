import {
  streamText,
  tool,
  isStepCount,
  generateText,
  jsonSchema,
  createTextStreamResponse,
} from 'ai';
import { getProvider } from '@/lib/llm-provider';
import { createHash } from 'node:crypto';
import { modelErrorMessage, modelSecrets } from '@/lib/model-error';
import { addMessage, getMemoryContext, searchMemory } from '@/lib/db';
import { getIdentity, setAssistantName, setUserName } from '@/lib/identity';
import { searchWeb, fetchPageText, searchImages } from '@/lib/search';
import { deepResearch } from '@/lib/research';
import { expertiseContext } from '@/lib/knowledge';
import { memoryBankContext } from '@/lib/memory-bank';
import {
  updateAvatarFromUrl,
  updateAvatarFromQuery,
  resetAvatar,
} from '@/lib/avatar';
import type { Settings } from '@/lib/settings';
import { activeCustomProvider, DEFAULT_SETTINGS, hasExplicitConnection, modelLabel } from '@/lib/settings';
import { localRequestAllowed } from '@/lib/request-origin';
import { thinkingOptions, thinkingOutputTokenLimit } from '@/lib/thinking-options';
import { safeRoutedModel, type JarvisEvent } from '@/lib/jarvis-protocol';
import { jarvisEffectiveSettings, jarvisModelSettings } from '@/lib/jarvis-model';
import { voiceContext } from '@/lib/voice-context';

// Derin araştırma; arama, sayfa okuma ve özetleme adımları nedeniyle normal
// sohbetten uzun sürebilir.
export const maxDuration = 300;

/**
 * Local (Ollama) modelin araç çağırma (tool calling) destekleyip desteklemediğini
 * `/api/show` üzerinden öğrenir. Sonuç kısa süreliğine önbelleklenir.
 */
const toolCapCache = new Map<string, { value: boolean; at: number }>();

async function localModelSupportsTools(ollamaUrl: string, model: string): Promise<boolean> {
  const base = (ollamaUrl || 'http://127.0.0.1:11434').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
  const key = `${base}|${model}`;
  const hit = toolCapCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;

  let value = true; // bilinmiyorsa iyimser davran
  try {
    const res = await fetch(`${base}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.capabilities)) {
        value = data.capabilities.includes('tools');
      }
    }
  } catch {
    /* endpoint yanıtlamıyorsa tools'u dene */
  }
  toolCapCache.set(key, { value, at: Date.now() });
  return value;
}

// Ollama capability bilgisinde tools görünse bile küçük llama3.2:1b modeli
// gerçek isteklerde zaman zaman ilgisiz araç çağrıları üretiyor (ör. normal
// bir selamı set_user_name çağrısına çeviriyor). Bu modelde temel cevap akışını
// bozmayacak şekilde araçları kapatıyoruz; otomatik isim algılama ve detaylı
// araştırma sunucu tarafında ayrıca çalışıyor.
function localToolsAreReliable(model: string): boolean {
  return !/^llama3\.2:1b$/iu.test(model.trim());
}

/**
 * Kullanıcının son mesajından otomatik isim değişikliği algılar.
 * "adın artık X olsun", "sana X diyeceğim", "ismin X olacak" gibi kalıplar.
 * Soru kalıpları ("adın ne?") tetiklenmez.
 */
// İsim kalıbı tek kelimelik adları güvenilir biçimde yakalar. Önceki
// tembel (non-greedy) kalıp "Ali" yerine yalnızca "A" kaydedebiliyordu.
const NAME_WORD = String.raw`[A-Za-zÇĞİÖŞÜçğıöşü][A-Za-zÇĞİÖŞÜçğıöşü0-9'’.\-]{0,28}`;

const ASSISTANT_NAME_PATTERNS: RegExp[] = [
  // "adın artık Luna olsun" / "adın Luna olacak"
  new RegExp(String.raw`\bad[ıi]n(?:[ıi]n)?\s+(?:art[ıi]k\s+|bundan sonra\s+)?(${NAME_WORD}?)\s+(?:olsun|olacak)`, 'iu'),
  // "ismin Luna olsun"
  new RegExp(String.raw`\bismin\s+(?:art[ıi]k\s+)?(${NAME_WORD}?)\s+(?:olsun|olacak)`, 'iu'),
  // "sana Luna diyeceğim / seni Luna diyeceğim"
  new RegExp(String.raw`\b(?:sana|seni)\s+(${NAME_WORD}?)\s+(?:diyece[ğg][ıi]m|diyece[ğg][ıi]z|diye seslenece[ğg][ıi]m|diye hitap edece[ğg][ıi]m|diyorum|diyelim)`, 'iu'),
  // "adını Luna olarak değiştir" / "yeni adın Luna"
  new RegExp(String.raw`\bad[ıi]n[ıi]n[ıi]?\s+(${NAME_WORD}?)\s+olarak\s+(?:de[ğg]i[şs]tir|ayarla|kaydet)`, 'iu'),
  new RegExp(String.raw`\byeni\s+ad[ıi]n[ıi]?\s*[:=]?\s*(${NAME_WORD}?)\s*$`, 'iu'),
];

const USER_NAME_PATTERNS: RegExp[] = [
  // "benim adım Ali" / "benim ismim Ali"
  new RegExp(String.raw`\bbenim\s+ad[ıi]m\s+(${NAME_WORD})(?=\s|[.!?,;:]|$)`, 'iu'),
  new RegExp(String.raw`\bbenim\s+ismim\s+(${NAME_WORD})(?=\s|[.!?,;:]|$)`, 'iu'),
  // "bana Ali de" / "bana Ali diye hitap et" / "bana Ali dersin"
  new RegExp(String.raw`\bbana\s+(${NAME_WORD}?)\s+(?:de|diyebilirsin|diye hitap et|diye seslen|dersin|diyeceksin)`, 'iu'),
  // "adımı Ali olarak kaydet"
  new RegExp(String.raw`\bad[ıi]m[ıi]\s+(${NAME_WORD}?)\s+olarak\s+(?:kaydet|hat[ıi]rla|bil)`, 'iu'),
];

const QUESTION_WORDS = /^(ne|nedir|kim|hangi|neler|kaç)$/i;

function shouldAutoResearch(text: string): boolean {
  return /(detaylı|derinlemesine|kapsamlı|uzun araştır|çok çalış|öğren|uzmanlaş|kaynakları? incele|güncel (bilgi|durum)|araştır)/iu.test(
    text
  );
}

function detectNameChange(
  text: string,
  patterns: RegExp[]
): string | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  for (const re of patterns) {
    const m = clean.match(re);
    if (m?.[1]) {
      const name = m[1].trim().replace(/[.!?,;:]+$/, '').trim();
      if (name && !QUESTION_WORDS.test(name)) return name.slice(0, 30);
    }
  }
  return null;
}

export async function POST(req: Request) {
  const startedAt = performance.now();
  if (!localRequestAllowed(req)) return new Response('Sohbet isteği bu uygulamadan yapılmalı.', { status: 403 });
  let body;
  try { body = await req.json(); } catch {
    return new Response('İstek gövdesi geçerli JSON olmalı.', { status: 400 });
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.messages) ||
      body.messages.length === 0 || body.messages.some((message: { role?: unknown; content?: unknown } | null) =>
        !message || !['user', 'assistant', 'system'].includes(String(message.role)) || typeof message.content !== 'string')) {
    return new Response('En az bir geçerli sohbet mesajı gerekli.', { status: 400 });
  }
  const { messages, settings, conversationId } = body;
  if (!hasExplicitConnection(settings)) return new Response('Etkin AI sağlayıcısını ayarlardan seç. Varsayılan sağlayıcıya otomatik geçilmedi.', { status: 400 });

  // Son kullanıcı mesajı hem sağlayıcı seçimi hem araç gereksinimi için gerekir.
  const lastUserContent =
    Array.isArray(messages) && messages.length > 0
      ? messages
          .slice()
          .reverse()
          .find((m: { role?: string; content?: string }) => m?.role === 'user')?.content
      : undefined;

  const incoming: Settings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  const jarvisMode = incoming.jarvisMode === true;
  const fastVoice = jarvisMode && incoming.jarvisFastMode !== false;
  const eventProtocol = jarvisMode && body.streamProtocol === 'jarvis-v1';
  // Sesli tur mu? Yalnızca mikrofon/hands-free girişleri `voiceTurn` gönderir.
  const voiceTurn = jarvisMode && body.voiceTurn === true;

  // Kullanıcı sözü internet/araç gerektiriyorsa ana bağlantı (varsayılan API) kullanılır.
  const utteranceNeedsTools = /araştır|internette|güncel|haber|hava durumu|kaynak|avatar|görselini|hatırlıyor/iu.test(lastUserContent || '');
  const needsTools = !fastVoice || utteranceNeedsTools;

  // Sağlayıcı seçimi:
  // - Hızlı SESLİ tur → Jarvis'e özel bağlantı (tanımlıysa), araç gerekmiyorsa.
  // - Yazılı sohbet / internet işi → ana bağlantı (FreeLLMAPI) + araçlar.
  const useJarvisConnection = voiceTurn && !needsTools;
  let s: Settings;
  try {
    s = useJarvisConnection ? jarvisEffectiveSettings(incoming) : jarvisModelSettings(incoming);
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : 'Jarvis bağlantısı yapılandırılamadı.',
      { status: 400 }
    );
  }
  if (fastVoice) s.thinkingMode = 'fast';
  let routedModel: string | null = null;
  let routingEvent: ((event: JarvisEvent) => void) | undefined;

  // Oturum sabitleme: FreeLLMAPI aynı konuşmada aynı modeli tercih eder (30 dk).
  // Konuşma kimliği yoksa ilk kullanıcı mesajından deterministik bir kimlik üretilir.
  const sessionSource = conversationId || (lastUserContent || '').slice(0, 400);
  const sessionId = sessionSource
    ? createHash('sha1').update(String(sessionSource)).digest('hex').slice(0, 32)
    : undefined;

  let provider;
  try {
    provider = getProvider(s, {
      ...(sessionId ? { headers: { 'X-Session-Id': sessionId } } : {}),
      onResponse: (headers) => {
        routedModel = safeRoutedModel(headers.get('x-routed-via'));
        if (routedModel) routingEvent?.({ type: 'routing', servedModel: routedModel });
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Model yapılandırması hatalı.';
    return new Response(msg, { status: 400 });
  }

  // Kullanıcının son mesajını kaydet
  if (conversationId && Array.isArray(messages) && messages.length > 0) {
    const lastUser = messages[messages.length - 1];
    if (lastUser?.role === 'user' && typeof lastUser.content === 'string') {
      try {
        addMessage(conversationId, 'user', lastUser.content);
      } catch {
        /* konuşma bulunamadı → boş ver */
      }
    }
  }

  // Otomatik isim değişikliği: "adın artık X olsun" → asistan adı,
  // "benim adım X" → kullanıcı adı. Model araç çağırmasa bile çalışır.
  if (typeof lastUserContent === 'string' && lastUserContent.trim()) {
    const newAssistantName = detectNameChange(lastUserContent, ASSISTANT_NAME_PATTERNS);
    if (newAssistantName) setAssistantName(newAssistantName);
    const newUserName = detectNameChange(lastUserContent, USER_NAME_PATTERNS);
    if (newUserName) setUserName(newUserName);
  }

  const identity = getIdentity();
  const assistantName = identity.assistantName || 'Chloe';
  const userName = identity.userName;
  const webSearchOn = s.webSearch !== false;
  const toolsSupported = needsTools && (
    s.provider === 'local'
      ? localToolsAreReliable(s.ollamaModel) &&
        (await localModelSupportsTools(s.ollamaUrl, s.ollamaModel))
      : s.cloudProvider !== 'custom' ||
        (activeCustomProvider(s)?.supportsTools ?? s.customSupportsTools));
  const webToolsOn = webSearchOn && toolsSupported;

  const memory = getMemoryContext(conversationId || null, fastVoice ? 8 : 60, fastVoice ? 2400 : 16000);
  const expertise = expertiseContext().slice(0, fastVoice ? 3000 : 20000);

  // Görsel eklerini modelin multimodal içerik parçalarına çevir. PDF/Word
  // metni istemci tarafından mesaj metnine eklenir; fotoğraflar ise data URL
  // olarak doğrudan görsel anlayabilen bulut modellere aktarılır.
  const modelMessages = Array.isArray(messages)
    ? (fastVoice && !needsTools ? voiceContext(messages) : messages).map((message: { role: string; content: string; attachments?: Array<{ dataUrl?: string; mimeType?: string }> }) => {
        const imageParts = (message.attachments || [])
          .filter((file) => file.dataUrl && file.mimeType?.startsWith('image/'))
          .map((file) => ({ type: 'file' as const, data: file.dataUrl as string, mediaType: file.mimeType as string }));
        return imageParts.length
          ? { ...message, content: [{ type: 'text' as const, text: message.content }, ...imageParts] }
          : message;
      })
    : messages;

  let systemPrompt = [
    `Sen bir kişisel AI asistanısın. Adın "${assistantName}".`,
    userName ? `Kullanıcının adı "${userName}". Ona bu adla hitap edebilirsin.` : '',
    'Daima Türkçe, samimi ama profesyonel konuş.',
    '',
    toolsSupported
      ? [
          'ARAÇ KULLANIMI:',
          webToolsOn
            ? '- Güncel, doğrulanması ya da internetten bilgi gerektiren sorularda önce `web_search` aracıyla arama yap; gerekirse `fetch_webpage` ile kaynak sayfayı oku. Kaynaklara dayanarak yanıt ver ve önemli kaynakları belirt.'
            : '- Web araması şu anda KAPALI. `web_search` kullanma; bilgine güvenerek yanıt ver.',
          '- Kullanıcı sana yeni bir isim verirse (örn. "adın artık X olsun" / "sana X diyeceğim") `set_assistant_name` aracını çağır.',
          '- Kullanıcı kendi adını söylerse (örn. "benim adım X" / "bana X de") `set_user_name` aracını çağır.',
          '- Kullanıcı senden bir konuyu ÖĞRENMENİ, çalışmanı, uzmanlaşmanı, derinlemesine araştırmanı veya ders çalışmanı isterse (örn. "şunu öğren", "bu konuda uzmanlaş", "araştır ve öğren", "kendini geliştir") `deep_research` aracını ÇAĞIR. Araç internetten birçok kaynak toplar, uzun ve yapılandırılmış bir uzmanlık notu üretir ve bilgi bankana KALICI olarak kaydeder. Kullanıcıya araştırmanın bittiğini ve ne öğrendiğini özetle.',
          '- Kullanıcı geçmiş konuşmalarınıza dair bir şey sorarsa ya da "hatırlıyor musun" gibi bir ifade kullanırsa `search_memory` aracıyla eski konuşmalarda ara.',
          '- Kullanıcı senin görselini/avatarını değiştirmeni isterse `update_avatar` aracını kullan: doğrudan görsel URLsi verdiyse `url` parametresiyle indir; yalnızca tarif ettiyse `query` parametresiyle internette görsel ara ve ilk uygun görseli indir. Görseli değiştirmek için önce `search_images` ile seçenekleri de listeleyebilirsin.',
        ].join('\n')
      : 'Not: Bu modelde araç çağırma yok; internet araması yapamazsın. Bilgine ve aşağıdaki hafızana güvenerek yanıt ver. Kullanıcı senin adını/görselini değiştirmek isterse bunu Ayarlar panelinden yapabileceğini söyle.',
    '',
    'HAFIZA:',
    'Aşağıda erişilebilen geçmiş kayıtları var; bağlama uyduğunda kullan. Görmediğin veya kaydedilmemiş bilgiyi hatırladığını iddia etme.',
    toolsSupported
      ? 'Ek bilgi gerektiğinde `search_memory` aracını çağır.'
      : '',
    membershipLines(memory, expertise),
    memoryBankContext(typeof lastUserContent === 'string' ? lastUserContent : ''),
  ]
    .filter((l) => l !== '')
    .join('\n');
  if (jarvisMode) {
    systemPrompt += [
      '',
      'JARVIS SESLİ ASİSTAN MODU:',
      '- Bu yanıt mevcut API anahtarıyla seçilmiş kullanıcının dil modeline gönderilmiştir.',
      '- Türkçe, kısa ve doğal konuş; sesli okunmaya uygun yanıt ver.',
      ...(fastVoice ? ['- Hızlı konuşma açık: önce kısa ve anlamlı ilk cümleyi hemen yaz. Olağan yanıtta 1–3 cümle yeterli. Kod, araştırma ve uzun rapor işleri JARVIS iş panelinden ekip olarak yürütülür; burada tamamladığını iddia etme.'] : []),
      '- Sohbet gibi konuş: kısa cümleler ve doğal geçişler kullan. Kullanıcı istemedikçe uzun listeler veya Markdown kullanma.',
      s.jarvisInstructions ? `Kullanıcının asistan tercihleri: ${s.jarvisInstructions.slice(0, 4000)}` : '',
      '- Kullanıcı sesle dikte ettiyse tekrarları ve bariz konuşma tanıma hatalarını anlamı değiştirmeden yorumla.',
      '- Mevcut araçları yalnızca kullanıcı isteğiyle kullan. Bir işlemi yaptığını ancak araç sonucu doğruluyorsa söyle.',
      '- Mesaj, dosya, bilgisayar komutu veya geri alınamaz işlem göndermeden önce açık onay iste; onaysız işlem yapma.',
      '- Bu mod tek başına işletim sistemi erişimi vermez; yalnızca uygulamada açıkça sunulan araçları kullan.',
    ].join('\n');
  }
  systemPrompt += `\nETKİN MODEL BAĞLANTISI: ${modelLabel(s)}. Kullanıcı hangi modeli kullandığını sorarsa bu yapılandırmayı açıkla; eski sohbetlerde geçen model adlarını mevcut bağlantı sanma. Özel API veya auto seçiliyse aracının arkasındaki gerçek alt modeli doğrulanmadıkça bildiğini iddia etme. API anahtarlarını asla isteme veya açıklama.`;

  // Derin araştırmada kullanılan özetleyici (aynı model)
  const summarize = async (notes: string, topic: string): Promise<string> => {
    const r = await generateText({
      model: provider,
      abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(90000)]),
      maxRetries: 0,
      providerOptions: thinkingOptions(s),
      system:
        'Sen özlü, doğru ve yapılandırılmış notlar üreten bir araştırma asistanısın. Türkçe yaz.',
      prompt: `Aşağıdaki kaynaklardan "${topic}" konusunda KAPSAMLI ve yapılandırılmış bir uzmanlık notu oluştur (400-700 kelime). Şu başlıkları kullan: "Tanım", "Nasıl Çalışır", "Önemli Kavramlar", "Kullanım Alanları / Örnekler", "Avantajlar ve Dezavantajlar", "Kaynaklar". Yalnızca verilen kaynaklara dayan; kesin olmayan bilgileri belirt.\n\n${notes.slice(0, 30000)}`,
    });
    return r.text.trim();
  };

  // Kullanıcı açıkça araştırma istemese bile, uzun/detaylı araştırma niyeti
  // taşıyan istekleri otomatik olarak çalıştır. Böylece modelin tool çağırmayı
  // atlamasına bağlı kalmadan kaynaklar toplanır ve kalıcı uzmanlığa eklenir.
  const automaticResearchRequested =
    !fastVoice && webSearchOn && typeof lastUserContent === 'string' && shouldAutoResearch(lastUserContent);
  if (automaticResearchRequested && typeof lastUserContent === 'string') {
    try {
      const research = await deepResearch(lastUserContent, summarize, req.signal);
      systemPrompt += `\n\nOTOMATİK DETAYLI ARAŞTIRMA SONUCU:\n${research.summary}\n\nKaynaklar:\n${research.sources.join('\n')}`;
    } catch (error) {
      systemPrompt += `\n\nOtomatik araştırma başlatıldı ancak tamamlanamadı: ${
        error instanceof Error ? error.message : 'bilinmeyen hata'
      }`;
    }
  }

  type ToolSet = NonNullable<Parameters<typeof streamText>[0]>['tools'];
  const tools: ToolSet = toolsSupported
    ? {
        set_assistant_name: tool({
      description:
        'Kullanıcı asistanın adını değiştirmek istediğinde çağır. Adı kalıcı olarak kaydeder.',
      inputSchema: jsonSchema<{ name: string }>({
        type: 'object',
        properties: { name: { type: 'string', description: 'Yeni asistan adı' } },
        required: ['name'],
      }),
      execute: async (args) => {
        const name = extractField(args, 'name');
        if (!name) return { error: 'Geçerli bir isim verilmedi.' };
        setAssistantName(name);
        return { assistantName: name };
      },
    }),

    set_user_name: tool({
      description:
        'Kullanıcı kendi adını söylediğinde çağır. Adı kalıcı olarak hatırlamak için kaydeder.',
      inputSchema: jsonSchema<{ name: string }>({
        type: 'object',
        properties: { name: { type: 'string', description: 'Kullanıcının adı' } },
        required: ['name'],
      }),
      execute: async (args) => {
        const name = extractField(args, 'name');
        if (!name) return { error: 'Geçerli bir isim verilmedi.' };
        setUserName(name);
        return { userName: name };
      },
    }),

    search_memory: tool({
      description:
        'Geçmiş konuşmalarda arama yapar. Kullanıcı önceki sohbetlerinize dair bir şey sorduğunda ya da bir konuyu hatırlaman gerektiğinde kullan.',
      inputSchema: jsonSchema<{ query: string }>({
        type: 'object',
        properties: { query: { type: 'string', description: 'Aranacak anahtar kelime veya cümle' } },
        required: ['query'],
      }),
      execute: async (args) => {
        const query = extractField(args, 'query') || '';
        const results = searchMemory(query, 15);
        return {
          query,
          count: results.length,
          results: results.map((r) => ({
            conversation: r.conversation.title,
            date: r.message.createdAt,
            role: r.message.role,
            content: r.message.content.slice(0, 800),
          })),
        };
      },
    }),

    update_avatar: tool({
      description:
        'Asistanın (Chloe) görselini/avatarını değiştirir. Görsel URLsi verilmişse `url` parametresini, tarif verilmişse `query` parametresini kullan (internette aranıp indirilir). Yeni görsel arayüze otomatik yansır.',
      inputSchema: jsonSchema<{ url?: string; query?: string }>({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'İndirilecek görselin doğrudan URLsi' },
          query: { type: 'string', description: 'Görsel aramak için açıklama (url yoksa)' },
        },
      }),
      execute: async (args) => {
        const url = extractField(args, 'url');
        const query = extractField(args, 'query');
        let state;
        if (url) {
          state = await updateAvatarFromUrl(url);
        } else if (query) {
          state = await updateAvatarFromQuery(query);
        } else {
          throw new Error('update_avatar için `url` veya `query` gerekli.');
        }
        return { success: true, file: state.file, updatedAt: state.updatedAt };
      },
    }),

    reset_avatar: tool({
      description:
        'Asistanın görselini varsayılan (orijinal) Chloe görseline döndürür.',
      inputSchema: jsonSchema<{ confirm: boolean }>({
        type: 'object',
        properties: { confirm: { type: 'boolean', description: 'true olmalı' } },
        required: ['confirm'],
      }),
      execute: async ({ confirm }) => {
        if (!confirm) return { reset: false };
        const state = resetAvatar();
        return { reset: true, file: state.file };
      },
    }),
      }
    : {};

  // Web araçları yalnızca web araması açıkken ve model tools desteklerken eklenir
  if (webToolsOn) {
    tools.web_search = tool({
      description:
        'İnternette arama yap; güncel bilgi, haber veya doğrulanması gereken konular için kullan. Başlık/özet listesi döndürür.',
      inputSchema: jsonSchema<{ query: string }>({
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Arama sorgusu (tercihen Türkçe)' },
        },
        required: ['query'],
      }),
      execute: async (args) => {
        const query = extractField(args, 'query') || '';
        const results = await searchWeb(query, 5);
        return { query, results };
      },
    });

    tools.fetch_webpage = tool({
      description:
        'Belirli bir URL açıp sayfanın metin içeriğini okur. Bir kaynağa derinlemesine bakmak gerektiğinde kullan.',
      inputSchema: jsonSchema<{ url: string }>({
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Okunacak sayfanın tam adresi' },
        },
        required: ['url'],
      }),
      execute: async ({ url }) => {
        const text = await fetchPageText(url, 8000);
        return { url, text };
      },
    });

    tools.search_images = tool({
      description:
        'İnternette görsel arar ve görsel URL listesi döndürür. Asistan görselini değiştirmeden önce adayları görmek için kullanılabilir.',
      inputSchema: jsonSchema<{ query: string }>({
        type: 'object',
        properties: { query: { type: 'string', description: 'Görsel arama sorgusu' } },
        required: ['query'],
      }),
      execute: async (args) => {
        const query = extractField(args, 'query') || 'genel';
        const images = await searchImages(query, 8);
        return { query, images };
      },
    });

    tools.deep_research = tool({
      description:
        automaticResearchRequested
          ? 'Otomatik detaylı araştırma zaten yapıldı ve sonucu sistem bağlamına eklendi. Yalnızca kullanıcı başka bir konu isterse bu aracı kullan.'
          : 'Bir konuda yoğun ve derin araştırma yapar: internetten çok sayıda kaynak toplar, sayfaları okur, kapsamlı ve yapılandırılmış bir uzmanlık notu üretir ve kalıcı bilgi bankasına kaydeder. Kullanıcı bir konuyu öğrenmek, uzmanlaşmak veya derinlemesine çalışmak istediğinde kullan.',
      inputSchema: jsonSchema<{ topic: string }>({
        type: 'object',
        properties: { topic: { type: 'string', description: 'Araştırılacak/uzmanlaşılacak konu' } },
        required: ['topic'],
      }),
      execute: async (args) => {
        const topic = extractField(args, 'topic') || '';
        if (!topic) return { error: 'Konu belirtilmedi.' };
        const result = await deepResearch(topic, summarize, req.signal);
        return result;
      },
    });
  }

  const result = streamText({
    model: provider,
    system: systemPrompt,
    messages: modelMessages,
    tools: toolsSupported ? tools : undefined,
    providerOptions: thinkingOptions(s),
    maxRetries: fastVoice ? 0 : 1,
    ...(fastVoice ? { maxOutputTokens: thinkingOutputTokenLimit(s, 768) } : {}),
    abortSignal: AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]),
    stopWhen: isStepCount(fastVoice ? 3 : 8),
    onFinish: async ({ text }) => {
      if (conversationId && text) {
        try {
          addMessage(conversationId, 'assistant', text);
        } catch {
          /* konuşma silinmiş olabilir */
        }
      }
    },
  });

  // Provider stream'i model/API hatasında reddedilebilir. Bu hatayı sessizce
  // boş 200 yanıtına dönüştürmek yerine istemciye ayrıntılı ve tanınabilir bir
  // hata metni aktar.
  const textStream = new ReadableStream<string>({
    async start(controller) {
      let closed = false;
      let firstTokenMs: number | null = null;
      const event = (value: JarvisEvent) => { if (!closed) controller.enqueue(`${JSON.stringify(value)}\n`); };
      if (eventProtocol) {
        routingEvent = event;
        event({ type: 'meta', connection: modelLabel(s), contextChars: systemPrompt.length });
        if (routedModel) event({ type: 'routing', servedModel: routedModel });
      }
      const reader = result.stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value.type === 'text-delta') {
            firstTokenMs ??= Math.round(performance.now() - startedAt);
            if (eventProtocol) event({ type: 'text', text: value.text });
            else controller.enqueue(value.text);
          }
          if (value.type === 'error') {
            const detail = modelErrorMessage(value.error, modelSecrets(s));
            if (eventProtocol) event({ type: 'error', message: detail });
            else controller.enqueue(`\n\n[CHLOE_MODEL_ERROR]${detail}`);
          }
        }
        if (eventProtocol) {
          event({ type: 'timing', firstTokenMs, totalMs: Math.round(performance.now() - startedAt) });
          event({ type: 'done' });
        }
        closed = true;
        controller.close();
      } catch (error: unknown) {
        const detail = modelErrorMessage(error, modelSecrets(s));
        if (eventProtocol) event({ type: 'error', message: detail });
        else controller.enqueue(`\n\n[CHLOE_MODEL_ERROR]${detail}`);
        closed = true;
        controller.close();
      } finally {
        reader.releaseLock();
        routingEvent = undefined;
      }
    },
  });
  return eventProtocol ? new Response(textStream.pipeThrough(new TextEncoderStream()), {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' },
  }) : createTextStreamResponse({ stream: textStream });
}

function membershipLines(memory: string, expertise: string): string {
  const lines: string[] = [];
  if (memory) {
    lines.push('Önceki konuşmalarınla ilgili hatırladıkların (gerekirse kullan):');
    lines.push(memory);
  }
  if (expertise) {
    lines.push('Uzmanlık bilgi bankan (bu konularda uzmanlaştın; kullanıcıya yardımcı olurken bu bilgiden yararlan):');
    lines.push(expertise);
  }
  return lines.join('\n');
}

/**
 * Zayıf yerel modeller bazen araç argümanını şema+değer karışımı olarak üretir
 * (örn. {"type":"object","properties":{"name":"Luna"}}). Bu yardımcı, değeri
 * doğrudan alandan veya iç içe nesnelerden güvenle çıkarır.
 */
function extractField(input: unknown, field: string): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const obj = input as Record<string, unknown>;

  const direct = obj[field];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const nested = [obj.properties, obj.arguments, obj.input, obj.params].find(
    (v): v is Record<string, unknown> => !!v && typeof v === 'object'
  );
  if (nested) {
    const v = nested[field];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}
