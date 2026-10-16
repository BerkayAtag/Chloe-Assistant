import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual canvas driver and voice callbacks with deterministic
// browser adapters. These unit tests do not claim real provider/microphone QA.
function load(relative, imports, globals) {
  const source = fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: (name) => {
    if (!(name in imports)) throw Error(`Unexpected import ${name}`);
    return imports[name];
  }, ...globals });
  return exports;
}
const speechText = load('../src/lib/speech-text.ts', {}, {});
const { splitSpeechText } = speechText;
const speechQueue = load('../src/lib/speech-queue.ts', {}, {});

function orbHarness(state = 'ready', reduced = false) {
  const effects = [], frames = new Map(), observers = [], arcs = [];
  let sequence = 0, color = '185, 230, 208', styleReads = 0;
  const context = { clearRect() { arcs.length = 0; }, createRadialGradient() { return { addColorStop() {} }; }, fillRect() {}, beginPath() {}, fill() {}, setTransform() {}, arc(x, y, radius) { arcs.push({ x, y, radius }); } };
  const canvas = { getContext: () => context };
  const media = { matches: reduced, addEventListener() {}, removeEventListener() {} };
  class Observer {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() { this.callback([{ contentRect: { width: 420, height: 420 }, isIntersecting: true }]); }
    disconnect() { this.disconnected = true; }
  }
  const document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const React = { useRef: (value) => ({ current: value === null ? canvas : value }), useEffect: (effect) => effects.push(effect) };
  const Orb = load('../src/components/VoiceOrb.tsx', { react: React, 'react/jsx-runtime': { jsx: () => null } }, {
    window: { matchMedia: () => media, devicePixelRatio: 3 }, document,
    getComputedStyle: () => { styleReads++; return { getPropertyValue: () => color }; },
    ResizeObserver: Observer, IntersectionObserver: Observer,
    requestAnimationFrame: (callback) => { const id = ++sequence; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id) => frames.delete(id),
  }).default;
  Orb({ state, theme: 'dark' });
  const cleanups = effects.map((effect) => effect());
  return { context, canvas, arcs, frames, document, observers,
    setColor(value) { color = value; }, get styleReads() { return styleReads; },
    tick(time) { const pending = [...frames.values()]; frames.clear(); pending.forEach((callback) => callback(time)); },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

for (const state of ['ready', 'starting', 'listening', 'thinking', 'preparing', 'speaking']) {
  test(`orb ${state}: all particles stay inside the sphere canvas at motion peaks`, () => {
    const h = orbHarness(state);
    for (let frame = 1; frame <= 100; frame++) {
      h.tick(frame * 33);
      assert.equal(h.arcs.length, 1100);
      for (const dot of h.arcs) assert.ok(dot.x - dot.radius >= 0 && dot.y - dot.radius >= 0 && dot.x + dot.radius <= 420 && dot.y + dot.radius <= 420);
    }
    assert.equal(h.canvas.width, 840, 'DPR capped at 2 for bounded GPU memory');
    h.dispose();
  });
}
test('speaking has substantially more motion than idle', () => {
  function movement(state) {
    const h = orbHarness(state);
    for (let i = 1; i < 100; i++) h.tick(i * 33);
    const before = h.arcs.map((a) => ({ ...a })); h.tick(3300);
    const distance = h.arcs.reduce((sum, a, i) => sum + Math.hypot(a.x - before[i].x, a.y - before[i].y), 0);
    h.dispose(); return distance;
  }
  assert.ok(movement('speaking') > movement('ready') * 1.5);
});
test('reduced motion draws a complete static sphere without an animation loop', () => {
  const h = orbHarness('speaking', true); h.tick(33);
  assert.equal(h.arcs.length, 1100); assert.equal(h.frames.size, 0); h.dispose();
});
test('theme is read after parent effects, on the first painted frame', () => {
  const h = orbHarness(); assert.equal(h.styleReads, 0);
  h.setColor('40, 118, 92'); h.tick(33);
  assert.match(h.context.fillStyle, /40, 118, 92/); assert.equal(h.styleReads, 1); h.dispose();
});
test('hidden pages pause animation; unmount releases observers and frames', () => {
  const h = orbHarness(); h.document.hidden = true; h.tick(33);
  assert.equal(h.frames.size, 0); h.dispose();
  assert.ok(h.observers.every((observer) => observer.disconnected));
});

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));
function voiceHarness() {
  const states = [], audios = [], recognitions = [], requests = [];
  const response = deferred(), playback = deferred();
  class Audio {
    constructor(src) { this.src = src; audios.push(this); }
    play() { return playback.promise; }
    pause() { this.paused = true; }
  }
  class Recognition {
    constructor() { recognitions.push(this); }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
  }
  const React = {
    useState(value) { const index = states.length; states.push(typeof value === 'function' ? value() : value); return [states[index], (next) => { states[index] = next; }]; },
    useRef: (value) => ({ current: value }), useEffect() {}, useCallback: (fn) => fn,
  };
  const hook = load('../src/hooks/useVoice.ts', { react: React, '@/lib/settings': { settingsForRequest: (s) => s }, '@/lib/speech-text': speechText, '@/lib/speech-queue': speechQueue }, {
    window: { SpeechRecognition: Recognition, speechSynthesis: { cancel() {} }, setTimeout, clearTimeout }, Audio, AbortController,
    URL: { createObjectURL: () => 'blob:unit-fixture', revokeObjectURL() {} },
    fetch: (_url, options) => { requests.push(options); return response.promise; },
  }).useVoice;
  const voice = hook({ settings: { jarvisSpeechEngine: 'main', provider: 'cloud', cloudProvider: 'custom' } });
  return { voice, states, audios, recognitions, requests, response, playback };
}
test('voice remains preparing until actual audio playback starts', async () => {
  const h = voiceHarness(); h.voice.speak('Test');
  assert.equal(h.states[2], false); assert.equal(h.states[3], true);
  h.response.resolve({ ok: true, blob: async () => ({}) }); await flush();
  assert.equal(h.states[2], false); assert.equal(h.states[3], true);
  h.playback.resolve(); await flush();
  assert.equal(h.states[2], true); assert.equal(h.states[3], false);
  h.audios[0].onended(); assert.equal(h.states[2], false);
});
test('cancelling pending speech cannot start playback after a late response', async () => {
  const h = voiceHarness(); h.voice.speak('Test'); h.voice.stopSpeaking();
  assert.equal(h.requests[0].signal.aborted, true);
  h.response.resolve({ ok: true, blob: async () => ({}) }); await flush();
  assert.equal(h.audios.length, 0); assert.equal(h.states[2], false); assert.equal(h.states[3], false);
});
test('provider errors stop the voice states and remain visible', async () => {
  const h = voiceHarness(); h.voice.speak('Test');
  h.response.resolve({ ok: false, json: async () => ({ error: 'Sağlayıcı ses desteklemiyor' }) }); await flush();
  assert.equal(h.states[2], false); assert.equal(h.states[3], false);
  assert.equal(h.states[7], 'Sağlayıcı ses desteklemiyor');
});
test('stopped dictation ignores late final results and error events', () => {
  const h = voiceHarness(); let delivered = 0;
  h.voice.startListening(() => delivered++); const recognition = h.recognitions[0];
  h.voice.stopListening();
  recognition.onstart();
  recognition.onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'iptal edildi' } }] });
  recognition.onerror({ error: 'network' });
  assert.equal(delivered, 0); assert.equal(h.states[7], null); assert.equal(h.states[0], false);
});

test('duplicate start requests do not replace or orphan the active microphone', () => {
  const h = voiceHarness(); let first = 0, second = 0;
  h.voice.startListening(() => first++);
  h.voice.startListening(() => second++);
  assert.equal(h.recognitions.length, 1);
  h.recognitions[0].onresult({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: 'tek sonuç' } }] });
  assert.equal(first, 1);
  assert.equal(second, 0);
});

test('native dictation submits the final transcript exactly once', () => {
  const states = [], effects = [], handlers = new Map(), messages = [];
  const window = {
    webkit: { messageHandlers: { chloeMac: { postMessage: (message) => messages.push(message) } } },
    addEventListener: (name, handler) => handlers.set(name, handler),
    removeEventListener: (name) => handlers.delete(name),
    setTimeout, clearTimeout,
  };
  const React = {
    useState(value) { const index = states.length; states.push(typeof value === 'function' ? value() : value); return [states[index], (next) => { states[index] = next; }]; },
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => effects.push(effect),
    useCallback: (fn) => fn,
  };
  const voice = load('../src/hooks/useVoice.ts', {
    react: React,
    '@/lib/settings': { settingsForRequest: (settings) => settings },
    '@/lib/speech-text': speechText, '@/lib/speech-queue': speechQueue,
  }, { window, AbortController, URL: { revokeObjectURL() {} } }).useVoice();
  const cleanups = effects.map((effect) => effect());
  let received = [];
  voice.startListening((text) => received.push(text));
  assert.equal(messages.find((message) => message.action === 'startDictation')?.action, 'startDictation');
  handlers.get('chloeNativeSpeechResult')({ detail: { started: true } });
  handlers.get('chloeNativeSpeechResult')({ detail: { text: 'Merhaba JARVIS', final: false } });
  assert.deepEqual(received, []);
  handlers.get('chloeNativeSpeechResult')({ detail: { text: 'Merhaba JARVIS', final: true } });
  handlers.get('chloeNativeSpeechResult')({ detail: { text: 'Merhaba JARVIS', final: true } });
  assert.deepEqual(received, ['Merhaba JARVIS']);
  assert.equal(states[0], false);
  assert.equal(states[1], false);
  cleanups.forEach((cleanup) => cleanup?.());
});

test('long TTS text is divided without dropping words or splitting Unicode characters', () => {
  const input = `${'İstanbul için önemli bir sesli yanıt. '.repeat(110)}🙂🚀`;
  const chunks = splitSpeechText(input, 350);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 350));
  assert.equal(chunks.join(' ').replace(/\s+/gu, ' '), input.trim().replace(/\s+/gu, ' '));
  assert.throws(() => splitSpeechText('text', 0), /positive integer/);
});

test('cloud TTS plays every text chunk in order and completes only after the final audio', async () => {
  const h = voiceHarness();
  let completed = 0;
  const text = 'Bu uzun yanıtın tamamı sırayla seslendirilmeli. '.repeat(100);
  h.voice.speak(text, { onEnd: () => completed++ });
  h.response.resolve({ ok: true, blob: async () => ({}) });
  await flush();
  assert.equal(h.audios.length, 1);
  const firstChunk = JSON.parse(h.requests[0].body).text;
  assert.ok(firstChunk.length <= 3500);
  h.playback.resolve();
  await flush();
  h.audios[0].onended();
  await flush();
  assert.equal(h.audios.length, 2);
  const secondChunk = JSON.parse(h.requests[1].body).text;
  assert.equal(`${firstChunk} ${secondChunk}`.replace(/\s+/gu, ' '), text.trim().replace(/\s+/gu, ' '));
  assert.equal(completed, 0);
  h.audios[1].onended();
  await flush();
  assert.equal(completed, 1);
  assert.equal(h.states[2], false);
  assert.equal(h.states[3], false);
});

test('native speech stays in preparing state until macOS reports actual playback', () => {
  const states = [], effects = [], handlers = new Map(), messages = [];
  const bridge = { postMessage: (message) => messages.push(message) };
  const window = {
    webkit: { messageHandlers: { chloeMac: bridge } },
    addEventListener: (name, handler) => handlers.set(name, handler),
    removeEventListener: (name) => handlers.delete(name),
    setTimeout, clearTimeout,
    speechSynthesis: { cancel() {} },
  };
  const React = {
    useState(value) { const index = states.length; states.push(typeof value === 'function' ? value() : value); return [states[index], (next) => { states[index] = next; }]; },
    useRef: (value) => ({ current: value }),
    useEffect: (effect) => effects.push(effect),
    useCallback: (fn) => fn,
  };
  const voice = load('../src/hooks/useVoice.ts', {
    react: React,
    '@/lib/settings': { settingsForRequest: (settings) => settings },
    '@/lib/speech-text': speechText, '@/lib/speech-queue': speechQueue,
  }, { window, AbortController, URL: { revokeObjectURL() {} } }).useVoice({
    settings: { jarvisSpeechEngine: 'device' },
  });
  const cleanups = effects.map((effect) => effect());
  let completed = 0;
  voice.speak('Merhaba.', { onEnd: () => completed++ });
  const request = messages.find((message) => message.action === 'speakText');
  assert.ok(request);
  assert.equal(states[2], false);
  assert.equal(states[3], true);

  const emit = (detail) => handlers.get('chloeNativeVoice')({ detail: { id: request.speechId, ...detail } });
  emit({ started: true });
  assert.equal(states[2], true);
  assert.equal(states[3], false);
  emit({ finished: true });
  assert.equal(states[2], false);
  assert.equal(states[3], false);
  assert.equal(completed, 1);
  cleanups.forEach((cleanup) => cleanup?.());
});

test('device speech announces preparation, speaking, and completion in order', () => {
  const states = [], utterances = [];
  const React = {
    useState(value) { const index = states.length; states.push(typeof value === 'function' ? value() : value); return [states[index], (next) => { states[index] = next; }]; },
    useRef: (value) => ({ current: value }),
    useEffect() {},
    useCallback: (fn) => fn,
  };
  class Utterance { constructor(text) { this.text = text; } }
  const window = {
    speechSynthesis: {
      getVoices: () => [{ voiceURI: 'tr-female', name: 'Samantha', lang: 'tr-TR' }],
      cancel() {},
      speak: (utterance) => utterances.push(utterance),
    },
    setTimeout, clearTimeout,
  };
  const voice = load('../src/hooks/useVoice.ts', {
    react: React,
    '@/lib/settings': { settingsForRequest: (settings) => settings },
    '@/lib/speech-text': speechText, '@/lib/speech-queue': speechQueue,
  }, { window, SpeechSynthesisUtterance: Utterance, AbortController, URL: { revokeObjectURL() {} } }).useVoice({
    settings: { jarvisSpeechEngine: 'device' },
  });

  let completed = 0;
  voice.speak('Merhaba.', { onEnd: () => completed++ });
  assert.equal(states[2], false);
  assert.equal(states[3], true);
  utterances[0].onstart();
  assert.equal(states[2], true);
  assert.equal(states[3], false);
  utterances[0].onend();
  assert.equal(states[2], false);
  assert.equal(states[3], false);
  assert.equal(completed, 1);
});
