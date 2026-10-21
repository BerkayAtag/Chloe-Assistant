import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanSpeechText, createSpeechTextBuffer, splitSpeechText } from '../src/lib/speech-text.ts';

test('kod blokları sesli okumada kısa bir cümleye dönüşür', () => {
  const spoken = cleanSpeechText('İşte örnek:\n```js\nconst a = 1;\n```\nBu kadar.');
  assert.ok(!spoken.includes('const a = 1'), 'kod gövdesi okunmamalı');
  assert.match(spoken, /Kod örneğini ekranda görebilirsin/);
  assert.match(spoken, /Bu kadar\./);
});

test('bağlantılar yalnızca metniyle okunur, URL okunmaz', () => {
  const spoken = cleanSpeechText('Ayrıntı için [belgeler](https://example.com/x?y=1) ve https://example.com adresine bak.');
  assert.ok(!spoken.includes('http'), 'URL okunmamalı');
  assert.match(spoken, /belgeler/);
});

test('tablo ve ayırıcı çizgiler sesli okumayı bozmaz', () => {
  const spoken = cleanSpeechText('| Model | Hız |\n| --- | --- |\n| auto:fast | yüksek |');
  assert.ok(!spoken.includes('|'), 'boru karakteri kalmamalı');
  assert.ok(!/\d+\s*\.\s*\d/.test(spoken));
  assert.match(spoken, /Model/);
  assert.match(spoken, /auto:fast/);
});

test('madde imleri ve numaralar okunmaz', () => {
  const spoken = cleanSpeechText('- Birinci madde\n- İkinci madde\n1. Üçüncü madde');
  assert.ok(!spoken.startsWith('-'));
  assert.ok(!/\b1\./.test(spoken));
  assert.match(spoken, /Birinci madde/);
  assert.match(spoken, /Üçüncü madde/);
});

test('emoji ve biçimlendirme işaretleri temizlenir', () => {
  const spoken = cleanSpeechText('Harika! 🎉 **Kalın** ve _eğik_ metin ✅');
  assert.ok(!/[\p{Extended_Pictographic}]/u.test(spoken), 'emoji kalmamalı');
  assert.ok(!spoken.includes('*') && !spoken.includes('_'));
  assert.match(spoken, /Harika!/);
  assert.match(spoken, /Kalın/);
});

test('HTML etiketleri ve alıntı işaretleri temizlenir', () => {
  const spoken = cleanSpeechText('> Alıntı satırı\n<div class="x">içerik</div>');
  assert.ok(!spoken.includes('<div'), 'etiket kalmamalı');
  assert.ok(!spoken.includes('>'));
  assert.match(spoken, /Alıntı satırı/);
  assert.match(spoken, /içeri/);
});

test('noktalama öncesi boşluk bırakılmaz', () => {
  assert.equal(cleanSpeechText('Merhaba   dünya .'), 'Merhaba dünya.');
});

test('akışlı tampon ilk cümleyi beklemeden seslendirir', () => {
  const clips = [];
  const buffer = createSpeechTextBuffer((text) => clips.push(text));
  buffer.push('Merhaba, bu ilk cümle yeterince uzun. ');
  assert.equal(clips.length, 1, 'ilk cümle akış sırasında hemen seslendirilmeli');
  assert.match(clips[0], /Merhaba, bu ilk cümle yeterince uzun\./);
  buffer.push('İkinci cümle de burada!');
  buffer.finish();
  assert.ok(clips.length >= 2, 'kalan metin de seslendirilmeli');
  assert.match(clips.join(' '), /İkinci cümle de burada!/);
});

test('kapatılmamış kod bloğu seslendirilmez, kapanınca bilgilendirme verilir', () => {
  const clips = [];
  const buffer = createSpeechTextBuffer((text) => clips.push(text));
  buffer.push('İşte kod:\n```js\nconst secret = 42;');
  assert.equal(clips.length, 0, 'kapanmamış kod bloğu bekletilmeli');
  buffer.push('\n```\nBitti.');
  buffer.finish();
  const spoken = clips.join(' ');
  assert.ok(!spoken.includes('const secret'), 'kod gövdesi hiç okunmamalı');
  assert.match(spoken, /Bitti\./);
});

test('uzun metin sınır uzunluğunu aşmadan parçalanır', () => {
  const chunks = splitSpeechText('kelime '.repeat(400), 120);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) assert.ok(chunk.length <= 120, `parça çok uzun: ${chunk.length}`);
});

test('geçersiz parça uzunluğu hata verir', () => {
  assert.throws(() => splitSpeechText('metin', 0), /positive integer/);
});

test('kısa selamlama yanıtın bitmesini beklemez ve ikinci cümle kaybolmaz', () => {
  const clips = []; const buffer = createSpeechTextBuffer(t => clips.push(t));
  buffer.push('Merhaba! ');
  assert.deepEqual(clips, ['Merhaba!']);
  buffer.push('Nasıl yardımcı olabilirim?'); buffer.finish();
  assert.equal(clips.join(' '), 'Merhaba! Nasıl yardımcı olabilirim?');
});

test('kısa kısaltma, ondalık ve bölünmüş kelime erken okunmaz', () => {
  const clips = []; const buffer = createSpeechTextBuffer(t => clips.push(t));
  buffer.push('Dr. '); assert.equal(clips.length, 0);
  buffer.push('Ada 3.14'); assert.equal(clips.length, 0);
  buffer.push(' diyor.'); buffer.finish();
  assert.equal(clips.join(' '), 'Dr. Ada 3.14 diyor.');
});
