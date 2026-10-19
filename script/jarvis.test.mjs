import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechQueue } from '../src/lib/speech-queue.ts';
import { jarvisEffectiveSettings, jarvisModelIssue, jarvisSpeechSettings } from '../src/lib/jarvis-model.ts';
import { createSpeechTextBuffer } from '../src/lib/speech-text.ts';
import { JarvisEventDecoder, safeRoutedModel } from '../src/lib/jarvis-protocol.ts';
import { jarvisCommand, jarvisBrowserUrl, officeStatusText } from '../src/lib/jarvis-command.ts';
import { jarvisModelSettings } from '../src/lib/jarvis-model.ts';
import { DEFAULT_SETTINGS, hasExplicitConnection, settingsForRequest } from '../src/lib/settings.ts';
import { apiRequestAllowed } from '../src/lib/request-origin.ts';
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('voice begins at the first sentence before the answer completes', () => {
  const spoken = []; const stream = createSpeechTextBuffer((s) => spoken.push(s));
  stream.push('Merhaba, sana yardımcı olabilirim. ');
  assert.deepEqual(spoken, ['Merhaba, sana yardımcı olabilirim.']);
  stream.push('İkinci cümle henüz bit'); assert.equal(spoken.length, 1);
  stream.push('medi.'); stream.finish();
  assert.equal(spoken[1], 'İkinci cümle henüz bitmedi.');
});
test('streamed fenced code is never read aloud as source code', () => {
  const spoken = []; const stream = createSpeechTextBuffer((s) => spoken.push(s));
  for (const token of ['İşte önerim:\n```js\nconst secret', 'Value = 42;\n```\n', 'İstersen bunu inceleyebilirsin. ']) stream.push(token);
  stream.finish(); assert.doesNotMatch(spoken.join(' '), /secretValue|const|42/);
  assert.match(spoken.join(' '), /Kod örneğini/);
});
test('unfinished code fence and formatting stay off speech output', () => {
  const spoken = []; const stream = createSpeechTextBuffer((s) => spoken.push(s));
  stream.push('**Öneri:** ```js\nconsole.log("x")'); stream.finish();
  assert.doesNotMatch(spoken.join(' '), /console|\*|```/);
});
test('jarvis settings never throw during render, even without a dedicated key', () => {
  const base = {
    jarvisMode: true, jarvisProvider: 'gemini', jarvisApiKey: '', jarvisModel: '', jarvisApiBaseUrl: '',
    provider: 'cloud', cloudProvider: 'custom', apiKey: 'main-key', apiBaseUrl: 'http://127.0.0.1:31415/v1',
    customModel: 'auto', customProviderName: 'FreeLLMAPI',
    jarvisSpeechProvider: 'inherit', jarvisSpeechApiKey: '', jarvisSpeechModel: '', jarvisSpeechApiBaseUrl: '',
  };
  for (const jarvisProvider of ['inherit', 'gemini', 'openai', 'anthropic', 'custom', 'local']) {
    const settings = { ...base, jarvisProvider };
    // Model etiketi render sırasında bu fonksiyonu çağırır: fırlatırsa arayüz çöker.
    const effective = jarvisEffectiveSettings(settings);
    assert.ok(effective, `${jarvisProvider}: etkin ayarlar dönmeli`);
    assert.doesNotThrow(() => jarvisSpeechSettings(settings), `${jarvisProvider}: ses çözümü fırlatmamalı`);
  }
  // Eksik anahtar sessizce ana bağlantıya düşer ve kullanıcı uyarılır.
  assert.equal(jarvisModelIssue({ ...base, jarvisProvider: 'gemini' })?.includes('ana bağlantı'), true);
  assert.equal(jarvisModelIssue({ ...base, jarvisProvider: 'inherit' }), null);
  // Ses için ayrı anahtar girilmişse çözümleme onu kullanır.
  const dedicated = jarvisSpeechSettings({ ...base, jarvisSpeechProvider: 'custom', jarvisSpeechApiKey: 'speech-key', jarvisSpeechApiBaseUrl: 'https://tts.example/v1' });
  assert.equal(dedicated.dedicated, true);
  assert.equal(dedicated.settings.apiKey, 'speech-key');
  assert.equal(dedicated.settings.apiBaseUrl, 'https://tts.example/v1');
  assert.equal(jarvisSpeechSettings({ ...base, jarvisSpeechProvider: 'custom', jarvisSpeechApiKey: '' }).dedicated, false);
});
test('Jarvis mic preflight selects its dedicated API without requiring a main API key', () => {
  const dedicated = {
    ...DEFAULT_SETTINGS,
    provider: 'cloud', cloudProvider: 'gemini', apiKey: '',
    jarvisMode: true, jarvisProvider: 'openai', jarvisApiKey: 'jarvis-only-key', jarvisModel: 'fast-model',
  };
  const effective = settingsForRequest(jarvisEffectiveSettings(dedicated));
  assert.equal(hasExplicitConnection(effective), true);
  assert.equal(effective.cloudProvider, 'openai');
  assert.equal(effective.apiKey, 'jarvis-only-key');
  const automatic = jarvisEffectiveSettings({ ...dedicated, jarvisModel: '' });
  assert.match(automatic.cloudModel, /^gpt-/);
  assert.doesNotMatch(automatic.cloudModel, /gemini/);
});
test('speech prepares at most current plus next and plays in order', async () => {
  const controller = new AbortController(), prepared = [], played = [], end = [];
  const gates = Array.from({ length: 3 }, deferred);
  const queue = createSpeechQueue({ signal: controller.signal, prepare: async (s) => { prepared.push(s); return s; }, play: async (s) => { played.push(s); await gates[Number(s)].promise; }, preparing() {}, ended: () => end.push(true), failed: (e) => { throw e; } });
  ['0', '1', '2'].forEach(queue.push); queue.finish(); await flush();
  assert.deepEqual(prepared, ['0', '1']); assert.deepEqual(played, ['0']);
  gates[0].resolve(); await flush(); assert.deepEqual(prepared, ['0', '1', '2']);
  gates[1].resolve(); await flush(); assert.equal(end.length, 0);
  gates[2].resolve(); await flush(); assert.deepEqual(played, ['0', '1', '2']); assert.equal(end.length, 1);
});
test('append after queue drains still plays and finish completes once', async () => {
  let ends = 0; const played = [];
  const queue = createSpeechQueue({ signal: new AbortController().signal, prepare: async (s) => s, play: async (s) => { played.push(s); }, preparing() {}, ended: () => ends++, failed: assert.fail });
  queue.push('one'); await flush(); assert.equal(ends, 0);
  queue.push('two'); queue.finish(); await flush(); queue.finish();
  assert.deepEqual(played, ['one', 'two']); assert.equal(ends, 1);
});
test('cancel ignores late preparation and never calls ended', async () => {
  const response = deferred(), controller = new AbortController(); let plays = 0, ends = 0;
  const queue = createSpeechQueue({ signal: controller.signal, prepare: () => response.promise, play: async () => { plays++; }, preparing() {}, ended: () => ends++, failed: assert.fail });
  queue.push('test'); queue.finish(); controller.abort(); response.resolve('late'); await flush();
  assert.equal(plays, 0); assert.equal(ends, 0);
});
test('a failing clip is skipped after one retry and the rest still plays', async () => {
  const played = [], skipped = []; let ends = 0, badAttempts = 0;
  const queue = createSpeechQueue({
    signal: new AbortController().signal,
    prepare: async (s) => { if (s === 'bad') { badAttempts++; throw new Error('provider failed'); } return s; },
    play: async (s) => { played.push(s); },
    preparing() {}, ended: () => ends++, failed: assert.fail,
    skipped: (e) => skipped.push(e.message),
  });
  queue.push('bir'); queue.push('bad'); queue.push('üç'); queue.finish();
  await flush();
  assert.deepEqual(played, ['bir', 'üç'], 'başarısız klipten sonra okuma sürmeli');
  assert.deepEqual(skipped, ['provider failed']);
  assert.equal(badAttempts, 2, 'başarısız klip bir kez yeniden denenir');
  assert.equal(ends, 1, 'tur tam olarak bir kez biter');
});
test('NDJSON protocol decodes arbitrary token boundaries and final line', () => {
  const events = [{ type: 'text', text: 'İstanbul🙂\nyanıt' }, { type: 'done' }];
  const wire = events.map(JSON.stringify).join('\n'); const decoder = new JarvisEventDecoder(); const received = [];
  for (const char of wire) received.push(...decoder.push(char));
  received.push(...decoder.push('', true)); assert.deepEqual(received, events);
});
test('permanent speech failures stop without retrying or starting later clips', async () => {
  const attempts = [], errors = []; let ended = 0;
  const queue = createSpeechQueue({
    signal: new AbortController().signal,
    prepare: async (text) => { attempts.push(text); throw Object.assign(new Error('quota'), { statusCode: 429 }); },
    shouldRetry: (error) => error.statusCode !== 429,
    play: assert.fail, preparing() {}, ended: () => ended++, failed: error => errors.push(error),
  });
  queue.push('first'); queue.push('prefetch'); queue.push('must not request'); queue.finish();
  await flush();
  assert.deepEqual(attempts, ['first', 'prefetch']);
  assert.equal(errors.length, 1); assert.equal(ended, 0);
  queue.push('late'); queue.finish(); await flush();
  assert.equal(errors.length, 1); assert.equal(attempts.length, 2);
});
test('protocol has bounded framing and does not trust malformed JSON', () => {
  assert.throws(() => new JarvisEventDecoder().push('x'.repeat(128001)));
  assert.throws(() => new JarvisEventDecoder().push('bad\n'));
  assert.equal(safeRoutedModel('kilo/dots-studio/dots-3:free'), 'kilo/dots-studio/dots-3:free');
  assert.equal(safeRoutedModel('https://user:secret@host'), null);
});
for (const [input, kind] of [
  ['hello.js dosyasını düzenle', 'team'], ['Kodlama yap', 'team'], ['Projemdeki hataları düzelt', 'team'],
  ['Ajan ekibini çalıştır', 'team'], ['Kapsamlı araştır ve rapor hazırla', 'report'], ['example.com sitesini aç', 'browser'],
  ['Finder uygulamasını aç', 'computer'], ['Ekibin durumu ne?', 'status'], ['Raporu oku', 'status'],
  ['Rapor sun', 'status'], ['Durum raporu', 'status'], ['Ekibi durdur', 'cancel'],
]) test(`intent: ${input}`, () => assert.equal(jarvisCommand(input)?.kind, kind));
for (const input of ['Kod nasıl yazılır?', 'Dosyayı değiştirme', 'Merhaba', 'Tarayıcı nedir?']) test(`conversation is not an action: ${input}`, () => assert.equal(jarvisCommand(input), null));
test('browser target requires an address and rejects credentials', () => {
  assert.equal(jarvisBrowserUrl('example.com sitesini aç.'), 'https://example.com/');
  assert.throws(() => jarvisBrowserUrl('tarayıcıyı aç'), /adresini/);
  assert.throws(() => jarvisBrowserUrl('https://user:secret@example.com'), /geçersiz/);
});
test('no fabricated status without a run', () => assert.match(officeStatusText(null), /Henüz/));
test('fast router affects only known FreeLLMAPI auto voice requests', () => {
  const settings = { ...DEFAULT_SETTINGS, provider: 'cloud', cloudProvider: 'custom', customProviderName: 'FreeLLMAPI', customModel: 'auto', apiBaseUrl: 'http://127.0.0.1:31415/v1', apiKey: 'qa-test', jarvisMode: true };
  const fast = jarvisModelSettings(settings);
  assert.equal(fast.customModel, 'auto:fast'); assert.equal(settings.customModel, 'auto');
  assert.equal(fast.apiKey, settings.apiKey); assert.equal(fast.apiBaseUrl, settings.apiBaseUrl);
  for (const patch of [{ jarvisMode: false }, { jarvisFastMode: false }, { customModel: 'explicit/model' }, { customProviderName: 'Other' }, { apiBaseUrl: 'https://other.example/v1' }]) {
    const current = { ...settings, ...patch }; assert.equal(jarvisModelSettings(current).customModel, current.customModel);
  }
});
test('central API guard rejects cross-site uploads, same-site other ports and DNS rebinding', () => {
  for (const pathname of ['/api/files', '/api/identity', '/api/conversations', '/api/projects', '/api/settings']) {
    assert.equal(apiRequestAllowed(new Request(`http://127.0.0.1:3004${pathname}`, { method: 'POST', headers: { Origin: 'https://attacker.example' } })), false);
    assert.equal(apiRequestAllowed(new Request(`http://127.0.0.1:3004${pathname}`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })), false);
    assert.equal(apiRequestAllowed(new Request(`http://localhost:3004${pathname}`, { headers: { 'Sec-Fetch-Site': 'same-site' } })), false);
  }
  assert.equal(apiRequestAllowed(new Request('http://rebind.example:3004/api/settings')), false);
  assert.equal(apiRequestAllowed(new Request('http://127.0.0.1:3004/api/settings', { headers: { Origin: 'http://127.0.0.1:3004', 'Sec-Fetch-Site': 'same-origin' } })), true);
});
test('OAuth navigation alone passes central guard; callback still owns state validation', () => {
  const headers = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' };
  assert.equal(apiRequestAllowed(new Request('http://127.0.0.1:3004/api/integrations/callback/google', { headers })), true);
  assert.equal(apiRequestAllowed(new Request('http://127.0.0.1:3004/api/integrations/connect/google', { headers })), false);
});
test('long opening sentence emits a natural first clause without waiting for its end', () => {
  const clips = []; const buffer = createSpeechTextBuffer((text) => clips.push(text));
  buffer.push('Seçtiğin proje üzerinde birlikte çalışabiliriz, ');
  assert.equal(clips.length, 1);
  buffer.push('önce dosyayı inceleyip sonra değişikliği öneririm. ');
  buffer.finish(); assert.equal(clips.length, 2);
  assert.match(clips[1], /değişikliği/);
});
