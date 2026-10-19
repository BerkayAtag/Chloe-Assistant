import assert from 'node:assert/strict';
import http from 'node:http';

/**
 * Jarvis'e özel API anahtarı davranışını kanıtlar:
 *  - Sesli turlar (voiceTurn) → Jarvis'e özel sağlayıcı/anahtar
 *  - Yazılı sohbet ve internet/araç gerektiren turlar → ana bağlantı
 *  - inherit seçiliyse sesli turlar da ana bağlantıyı kullanır
 *  - Ses sentezi (/api/voice) Jarvis modunda Jarvis anahtarını kullanır
 */

const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
let checks = 0;
const check = (label, value) => { assert.ok(value, label); console.log('PASS', label); checks++; };

function mockProvider(name, marker) {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    let input = '';
    for await (const part of req) input += part;
    let parsed = {};
    try { parsed = JSON.parse(input); } catch { /* ses istekleri JSON olabilir */ }
    seen.push({ url: req.url || '', auth: req.headers.authorization || '', body: parsed });

    if ((req.url || '').includes('/audio/speech')) {
      if (parsed.model === 'quota-test') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Quota exceeded for speech-key' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      res.end(Buffer.from('RIFF0000WAVEfmt data' + marker));
      return;
    }
    if (parsed.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Routed-Via': `${name}/upstream` });
      const chunk = (delta, finish) => `data: ${JSON.stringify({ id: name, object: 'chat.completion.chunk', created: 1, model: parsed.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.write(chunk({ content: marker }, null));
      res.write(chunk({}, 'stop'));
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: name, object: 'chat.completion', created: 1, model: parsed.model,
      choices: [{ index: 0, message: { role: 'assistant', content: marker }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    }));
  });
  return { server, seen, name };
}

const main = mockProvider('main', 'ANA-BAGLANTI');
const jarvis = mockProvider('jarvis', 'JARVIS-OZEL');
await new Promise((resolve) => main.server.listen(0, '127.0.0.1', resolve));
await new Promise((resolve) => jarvis.server.listen(0, '127.0.0.1', resolve));
const mainUrl = `http://127.0.0.1:${main.server.address().port}/v1`;
const jarvisUrl = `http://127.0.0.1:${jarvis.server.address().port}/v1`;

const settings = {
  provider: 'cloud', cloudProvider: 'custom', apiKey: 'main-key', apiBaseUrl: mainUrl,
  customModel: 'main-model', customProviderName: 'MainQA', customSupportsTools: true,
  savedCustomProviders: [], selectedCustomProviderId: '',
  jarvisMode: true, jarvisFastMode: true,
  jarvisProvider: 'custom', jarvisApiKey: 'jarvis-key', jarvisApiBaseUrl: jarvisUrl, jarvisModel: 'jarvis-model',
  webSearch: true,
};
const inherited = { ...settings, jarvisProvider: 'inherit', jarvisApiKey: '', jarvisApiBaseUrl: '', jarvisModel: '' };
const headers = { 'Content-Type': 'application/json', Origin: base };
const post = (route, body) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) });

try {
  // 1) Yazılı Jarvis sohbeti → ana bağlantı
  main.seen.length = 0; jarvis.seen.length = 0;
  let response = await post('/api/chat', { settings, messages: [{ role: 'user', content: 'Merhaba' }], streamProtocol: 'jarvis-v1' });
  let text = await response.text();
  check('yazılı sohbet ana bağlantıya gider', main.seen.length === 1 && jarvis.seen.length === 0);
  check('yazılı sohbette ana anahtar kullanılır', main.seen[0]?.auth === 'Bearer main-key');
  check('yazılı sohbette ana model kullanılır', main.seen[0]?.body?.model === 'main-model');
  check('yazılı sohbet yanıtı ana bağlantıdan gelir', text.includes('ANA-BAGLANTI'));

  // 2) Sesli tur → Jarvis'e özel bağlantı
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/chat', { settings, messages: [{ role: 'user', content: 'Merhaba' }], streamProtocol: 'jarvis-v1', voiceTurn: true });
  text = await response.text();
  check('sesli tur Jarvis özel bağlantısına gider', jarvis.seen.length === 1 && main.seen.length === 0);
  check('sesli turda Jarvis anahtarı kullanılır', jarvis.seen[0]?.auth === 'Bearer jarvis-key');
  check('sesli turda Jarvis modeli kullanılır', jarvis.seen[0]?.body?.model === 'jarvis-model');
  check('sesli tur yanıtı Jarvis bağlantısından gelir', text.includes('JARVIS-OZEL'));

  // 3) Araç gerektiren sesli tur → ana bağlantı + araçlar
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/chat', { settings, messages: [{ role: 'user', content: 'İnternette güncel haberleri araştır' }], streamProtocol: 'jarvis-v1', voiceTurn: true });
  await response.text();
  check('araç gerektiren sesli tur ana bağlantıya döner', main.seen.length === 1 && jarvis.seen.length === 0);
  check('araç gerektiren turda araçlar gönderilir', Array.isArray(main.seen[0]?.body?.tools) && main.seen[0].body.tools.length > 0);

  // 4) inherit → sesli tur da ana bağlantıyı kullanır
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/chat', { settings: inherited, messages: [{ role: 'user', content: 'Merhaba' }], streamProtocol: 'jarvis-v1', voiceTurn: true });
  await response.text();
  check('inherit seçiliyken sesli tur ana bağlantıyı kullanır', main.seen.length === 1 && jarvis.seen.length === 0);

  // 5) Ses sentezi (TTS) Jarvis modunda Jarvis anahtarını kullanır
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/voice', { text: 'Kısa bir deneme cümlesi.', settings });
  const voiceOk = response.ok;
  const bytes = new Uint8Array(await response.arrayBuffer());
  check('ses sentezi Jarvis özel uç noktasına gider', jarvis.seen.some((entry) => entry.url.includes('/audio/speech')));
  check('ses sentezinde Jarvis anahtarı kullanılır', jarvis.seen.find((entry) => entry.url.includes('/audio/speech'))?.auth === 'Bearer jarvis-key');
  check('ses sentezi gerçek ses döndürür', voiceOk && bytes.byteLength > 0);

  // 6) Jarvis modu kapalıyken ses sentezi ana bağlantıyı kullanır
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/voice', { text: 'Kısa bir deneme cümlesi.', settings: { ...settings, jarvisMode: false } });
  await response.arrayBuffer();
  check('Jarvis kapalıyken ses sentezi ana bağlantıyı kullanır', main.seen.some((entry) => entry.url.includes('/audio/speech')) && jarvis.seen.length === 0);

  // 7) Jarvis anahtarı boşken ÇÖKME YOK: ana bağlantıya düşer ve kullanıcı
  //    arayüzde uyarılır (önceki sürümde burada 400 dönüyordu ve model etiketi
  //    render sırasında fırlattığı için tüm arayüz çöküyordu).
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/chat', {
    settings: { ...settings, jarvisProvider: 'gemini', jarvisApiKey: '', jarvisApiBaseUrl: '' },
    messages: [{ role: 'user', content: 'Merhaba' }], streamProtocol: 'jarvis-v1', voiceTurn: true,
  });
  const missingKeyText = await response.text();
  check('eksik Jarvis anahtarında sohbet çalışmaya devam eder', response.status === 200 && missingKeyText.includes('ANA-BAGLANTI'));
  check('eksik anahtarda ana bağlantıya düşer, Jarvis uç noktasına istek gitmez', main.seen.length === 1 && jarvis.seen.length === 0);
  check('eksik anahtarda ana anahtar kullanılır', main.seen[0]?.auth === 'Bearer main-key');

  // 8) Jarvis sağlayıcısı ses üretemiyorsa (OpenAI) ses ANA bağlantıdan üretilir
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/voice', {
    text: 'Ses yine de çalışmalı.', settings: { ...settings, jarvisProvider: 'openai', jarvisApiKey: 'openai-key', jarvisApiBaseUrl: '' },
  });
  const fallbackBytes = new Uint8Array(await response.arrayBuffer());
  check('ses üretemeyen Jarvis sağlayıcısında ses ana bağlantıya düşer', response.ok && fallbackBytes.byteLength > 0);
  check('ana bağlantı ana anahtarıyla ses üretir', main.seen.find((entry) => entry.url.includes('/audio/speech'))?.auth === 'Bearer main-key');
  check('Jarvis anahtarı ana sağlayıcıya sızmaz', !main.seen.some((entry) => entry.auth === 'Bearer openai-key'));

  // 9) SES İÇİN AYRI API: ses sentezi ayrı anahtarla üretilir, sohbet etkilenmez
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/voice', {
    text: 'Ayrı ses API denemesi.', settings: { ...settings, jarvisSpeechProvider: 'custom', jarvisSpeechApiKey: 'speech-key', jarvisSpeechApiBaseUrl: jarvisUrl, jarvisSpeechModel: 'tts-fast' },
  });
  const speechBytes = new Uint8Array(await response.arrayBuffer());
  const speechHit = jarvis.seen.find((entry) => entry.url.includes('/audio/speech'));
  check('ses için ayrı API kullanılır', response.ok && speechBytes.byteLength > 0 && Boolean(speechHit));
  check('ses isteğinde ses anahtarı kullanılır', speechHit?.auth === 'Bearer speech-key');
  check('ses isteğinde ses modeli kullanılır', speechHit?.body?.model === 'tts-fast');
  check('ses için ayrı API seçilince ana bağlantıya ses isteği gitmez', !main.seen.some((entry) => entry.url.includes('/audio/speech')));

  // 10) Ses için ayrı API eksikse ses kaybolmaz, Jarvis/ana bağlantıya düşer
  main.seen.length = 0; jarvis.seen.length = 0;
  response = await post('/api/voice', {
    text: 'Eksik ses API denemesi.', settings: { ...settings, jarvisSpeechProvider: 'custom', jarvisSpeechApiKey: '', jarvisSpeechApiBaseUrl: '' },
  });
  await response.arrayBuffer();
  check('eksik ses API yapılandırmasında ses ana bağlantıdan üretilir', main.seen.some((entry) => entry.url.includes('/audio/speech')));

  response = await post('/api/voice', {
    text: 'Kota hata testi.', settings: { ...settings, jarvisSpeechProvider: 'custom', jarvisSpeechApiKey: 'speech-key', jarvisSpeechApiBaseUrl: jarvisUrl, jarvisSpeechModel: 'quota-test' },
  });
  const quota = await response.json();
  check('ses kotası terminal 429 durumuyla korunur', response.status === 429);
  check('kota hatası anlaşılır ve anahtar gizlidir', quota.error.includes('kotası') && !quota.error.includes('speech-key'));

  console.log(`TOTAL ${checks} passed. Jarvis özel anahtar ve ses API yönlendirmesi doğrulandı.`);
} finally {
  main.server.close();
  jarvis.server.close();
}
