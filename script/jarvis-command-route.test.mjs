import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('high-confidence intent still returns a command draft compatible with computer UI', async () => {
  const source = fs.readFileSync(new URL('../src/app/api/jarvis/command/route.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  let called = false;
  const imports = {
    ai: { Output: { json: () => ({}) }, generateText: async ({ prompt }) => {
      called = true; assert.equal(prompt, 'open Calculator');
      return { text: JSON.stringify({ command: '/usr/bin/open -a Calculator', explanation: 'Hesap Makinesi açılır.' }) };
    } },
    'next/server': { NextResponse: Response },
    '@/lib/llm-provider': { getProvider: () => ({}) },
    '@/lib/settings': { DEFAULT_SETTINGS: {}, hasExplicitConnection: () => true },
    '@/lib/request-origin': { localRequestAllowed: () => true },
    '@/lib/model-error': { modelSecrets: () => [], modelErrorMessage: e => e.message },
    '@/lib/thinking-options': { thinkingOptions: () => ({}) },
    '@/lib/command-parser': { parseCommand: () => ({ intent: 'open_app', entities: { target: 'Calculator' }, confidence: 0.9, needsClarification: false }) },
  };
  vm.runInNewContext(code, { exports, AbortSignal, require: name => { if (!(name in imports)) throw Error(name); return imports[name]; } });
  const response = await exports.POST(new Request('http://127.0.0.1/api/jarvis/command', { method: 'POST', body: JSON.stringify({ instruction: 'open Calculator', settings: {} }) }));
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(called, true);
  assert.equal(result.command, '/usr/bin/open -a Calculator');
  assert.equal(typeof result.explanation, 'string');
});
