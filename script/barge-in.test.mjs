import assert from 'node:assert/strict';
import test from 'node:test';
import { createBargeInDetector, rmsLevel, DEFAULT_BARGE_IN } from '../src/lib/barge-in.ts';

test('tek karelik yüksek ses kesme sayılmaz', () => {
  let clock = 0;
  const detector = createBargeInDetector({ threshold: 0.05, holdMs: 200 }, () => clock);
  assert.equal(detector.push(0.2), false, 'ilk kare yalnızca sayacı başlatır');
  clock += 50;
  assert.equal(detector.push(0.01), false, 'ses kesildi, sayaç sıfırlanır');
  clock += 500;
  assert.equal(detector.push(0.2), false, 'yeni sayaç başladı');
});

test('eşik üstünde yeterince kalırsa kesme tetiklenir ve bir kez bildirilir', () => {
  let clock = 0;
  const detector = createBargeInDetector({ threshold: 0.05, holdMs: 200 }, () => clock);
  detector.push(0.2);
  clock += 100;
  assert.equal(detector.push(0.2), false, 'süre dolmadı');
  clock += 120;
  assert.equal(detector.push(0.2), true, 'süre doldu → kesme');
  clock += 500;
  assert.equal(detector.push(0.9), false, 'aynı turda ikinci kez tetiklenmez');
  assert.equal(detector.armed, false);
  detector.reset();
  assert.equal(detector.armed, true, 'yeni tur için yeniden hazır');
  assert.equal(detector.push(0.3), false);
});

test('eşik altındaki ses (oda gürültüsü) tetiklemez', () => {
  let clock = 0;
  const detector = createBargeInDetector({ threshold: 0.05, holdMs: 200 }, () => clock);
  for (let index = 0; index < 20; index += 1) {
    clock += 50;
    assert.equal(detector.push(0.02), false);
  }
  assert.equal(detector.armed, true);
});

test('sıfır bekleme süresi ilk karede tetikler', () => {
  const detector = createBargeInDetector({ threshold: 0.05, holdMs: 0 });
  assert.equal(detector.push(0.5), true);
});

test('geçersiz enerji değerleri yok sayılır', () => {
  const detector = createBargeInDetector(DEFAULT_BARGE_IN);
  assert.equal(detector.push(Number.NaN), false);
  assert.equal(detector.push(Number.POSITIVE_INFINITY), false);
});

test('RMS seviyesi sessizlikte sıfır, yüksek seste belirgin', () => {
  assert.equal(rmsLevel([]), 0);
  assert.equal(rmsLevel(new Float32Array(64)), 0);
  const loud = new Float32Array(64).fill(0.5);
  assert.ok(Math.abs(rmsLevel(loud) - 0.5) < 1e-6);
  const quiet = new Float32Array(64).fill(0.01);
  assert.ok(rmsLevel(quiet) < DEFAULT_BARGE_IN.threshold, 'oda gürültüsü eşiğin altında kalmalı');
});
