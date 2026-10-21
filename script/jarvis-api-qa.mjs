import assert from 'node:assert/strict';
import http from 'node:http';
const base = process.env.CHLOE_TEST_URL || 'http://127.0.0.1:3004';
let checks = 0, captured, commandReply = JSON.stringify({ command: '/usr/bin/open -a Calculator', explanation: 'Hesap Makinesi açılır.' });
const check = (label, value) => { assert.ok(value, label); console.log('PASS', label); checks++; };
const server = http.createServer(async (req, res) => {
  let input = ''; for await (const part of req) input += part;
  captured = JSON.parse(input);
  if (!captured.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'qa', object: 'chat.completion', created: 1, model: captured.model, choices: [{ index: 0, message: { role: 'assistant', content: commandReply }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 } })); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'X-Routed-Via': 'qa/selected-upstream' });
  const delta = (text, finish = null) => `data: ${JSON.stringify({ id: 'qa', object: 'chat.completion.chunk', created: 1, model: captured.model, choices: [{ index: 0, delta: { content: text }, finish_reason: finish }] })}\n\n`;
  res.write(delta('Merhaba, ilk cümle hemen hazır. '));
  const timer = setTimeout(() => { res.write(delta('İkinci cümle sonra tamamlandı.', 'stop')); res.end('data: [DONE]\n\n'); }, 150);
  res.on('close', () => clearTimeout(timer));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const settings = { provider: 'cloud', cloudProvider: 'custom', apiKey: 'qa-only', apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`, customModel: 'qa-chosen-model', cloudModel: 'qa-chosen-model', customProviderName: 'QA', customSupportsTools: true, savedCustomProviders: [], selectedCustomProviderId: '', jarvisMode: true, jarvisFastMode: true, webSearch: false };
const headers = { 'Content-Type': 'application/json', Origin: base };
const post = (route, body, extra = {}) => fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body), ...extra });
try {
  const response = await post('/api/chat', { settings, messages: [{ role: 'user', content: 'Merhaba' }], streamProtocol: 'jarvis-v1' });
  check('typed Jarvis protocol is returned', response.status === 200 && response.headers.get('content-type').includes('application/x-ndjson'));
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  check('selected custom model receives chat, not a built-in fallback', captured.model === 'qa-chosen-model');
  check('simple fast speech does not load unnecessary tools', !captured.tools?.length);
  check('fast speech uses bounded output', (captured.max_tokens || captured.max_completion_tokens) <= 768);
  check('text fragments arrive independently', events.filter((e) => e.type === 'text').length === 2);
  check('upstream routing is visible', events.some((e) => e.type === 'routing' && e.servedModel === 'qa/selected-upstream'));
  check('timing is measured and stream has completion marker', events.some((e) => e.type === 'timing' && e.firstTokenMs <= e.totalMs) && events.at(-1).type === 'done');
  const legacy = await post('/api/chat', { settings: { ...settings, jarvisMode: false }, messages: [{ role: 'user', content: 'Merhaba' }] });
  check('ordinary chat keeps legacy text response', legacy.status === 200 && (await legacy.text()).startsWith('Merhaba'));
  const longHistory = [{ role: 'user', content: 'old-context '.repeat(2000) }, { role: 'assistant', content: 'Önceki kısa yanıt.' }, { role: 'user', content: 'Merhaba!' }];
  const bounded = await post('/api/chat', { settings, messages: longHistory, voiceTurn: true, streamProtocol: 'jarvis-v1' });
  await bounded.text();
  check('fast voice bounds old context but keeps latest instruction', !JSON.stringify(captured.messages).includes('old-context ') && captured.messages.at(-1).content === 'Merhaba!');
  const regular = await post('/api/chat', { settings: { ...settings, jarvisMode: false }, messages: longHistory });
  await regular.text();
  check('normal chat retains its complete context', JSON.stringify(captured.messages).includes('old-context '));
  const invalid = await post('/api/chat', { settings: {}, messages: [{ role: 'user', content: 'Hello' }], streamProtocol: 'jarvis-v1' });
  check('missing connection cannot silently select Gemini', invalid.status === 400);
  const command = await post('/api/jarvis/command', { instruction: 'Hesap Makinesini aç', settings });
  const suggestion = await command.json();
  check('computer action is a proposal from selected model', command.status === 200 && suggestion.command === '/usr/bin/open -a Calculator' && captured.model === 'qa-chosen-model');
  commandReply = 'not JSON';
  check('malformed command reply fails visibly', (await post('/api/jarvis/command', { instruction: 'Calculator aç', settings })).status === 400);
  commandReply = JSON.stringify({ command: 'echo first\necho second', explanation: 'invalid' });
  check('multiline/control character commands rejected', (await post('/api/jarvis/command', { instruction: 'Calculator aç', settings })).status === 400);
  check('foreign origin cannot request a command', (await post('/api/jarvis/command', { instruction: 'Calculator aç', settings }, { headers: { ...headers, Origin: 'https://foreign.example' } })).status === 403);
} finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
console.log(`TOTAL ${checks} passed. No project files or credentials changed.`);
