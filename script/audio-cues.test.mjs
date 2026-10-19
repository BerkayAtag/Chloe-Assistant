import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_CUES, cueDuration, playCueOn } from '../src/lib/audio-cues.ts';

test('her sinyalin nota dizisi ve süresi tanımlı', () => {
  for (const cue of Object.keys(AUDIO_CUES)) {
    assert.ok(AUDIO_CUES[cue].length > 0, `${cue} boş olmamalı`);
    assert.ok(cueDuration(cue) > 0, `${cue} süresi pozitif olmalı`);
  }
  assert.ok(cueDuration('mic-open') < 500, 'açılış sinyali yarım saniyeden kısa olmalı');
});

test('osilatörler doğru zamanlanır ve bağlanır', () => {
  const started = [];
  const stopped = [];
  const connected = [];
  const context = {
    currentTime: 10,
    destination: { id: 'dest' },
    createOscillator: () => ({
      type: 'sine',
      frequency: { setValueAtTime: (value, at) => started.push({ kind: 'freq', value, at }) },
      connect: (node) => connected.push(node),
      start: (at) => started.push({ kind: 'start', at }),
      stop: (at) => stopped.push(at),
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: (value, at) => started.push({ kind: 'gain', value, at }),
        exponentialRampToValueAtTime: (value, at) => started.push({ kind: 'ramp', value, at }),
      },
      connect: (node) => connected.push(node),
    }),
  };
  playCueOn(context, 'mic-open');
  assert.equal(started.filter((entry) => entry.kind === 'start').length, AUDIO_CUES['mic-open'].length, 'her nota için osilatör başlatılmalı');
  assert.equal(stopped.length, AUDIO_CUES['mic-open'].length, 'her osilatör durdurulmalı');
  assert.ok(connected.some((node) => node?.id === 'dest'), 'hedefe bağlanmalı');
  assert.ok(started.every((entry) => entry.at >= 10), 'zamanlar context.currentTime temel alınmalı');
});

test('bozuk AudioContext akışı bozmaz', () => {
  const broken = {
    currentTime: 0,
    destination: {},
    createOscillator: () => { throw new Error('audio yok'); },
    createGain: () => { throw new Error('audio yok'); },
  };
  assert.doesNotThrow(() => playCueOn(broken, 'mic-close'));
});
