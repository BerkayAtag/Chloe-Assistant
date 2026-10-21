// Test suite for Universal Tool Registry ported from Jarvis
// Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, getToolRegistry } from '../src/lib/tool-registry.ts';
import { registerBuiltinTools } from '../src/lib/builtin-tools.ts';

// ── ToolRegistry Core Tests ──────────────────────────────────────────────────

test('registry: register and check tool existence', () => {
  const reg = new ToolRegistry();
  reg.register('test_tool', 'A test tool', { type: 'object', properties: {} }, async () => 'ok');

  assert.equal(reg.has('test_tool'), true);
  assert.equal(reg.has('nonexistent'), false);
  assert.equal(reg.size, 1);
  assert.deepEqual(reg.names(), ['test_tool']);
});

test('registry: execute tool', async () => {
  const reg = new ToolRegistry();
  reg.register(
    'echo',
    'Echoes input',
    { type: 'object', properties: { msg: { type: 'string' } } },
    async (args) => `echo: ${args.msg}`
  );

  const result = await reg.execute('echo', { msg: 'hello' });
  assert.equal(result, 'echo: hello');
});

test('registry: execute unknown tool throws', async () => {
  const reg = new ToolRegistry();
  await assert.rejects(
    async () => reg.execute('missing', {}),
    /Bilinmeyen araç: "missing"/
  );
});

test('registry: requiresApproval flag', () => {
  const reg = new ToolRegistry();
  reg.register('safe', 'Safe tool', { type: 'object', properties: {} }, async () => 'ok');
  reg.register('dangerous', 'Risky tool', { type: 'object', properties: {} }, async () => 'ok', { requiresApproval: true });

  assert.equal(reg.requiresApproval('safe'), false);
  assert.equal(reg.requiresApproval('dangerous'), true);
});

test('registry: getDefinitions format (OpenAI-compatible)', () => {
  const reg = new ToolRegistry();
  reg.register(
    'calc',
    'Calculator',
    {
      type: 'object',
      properties: { expr: { type: 'string', description: 'Expression' } },
      required: ['expr'],
    },
    async () => '0'
  );

  const defs = reg.getDefinitions();
  assert.equal(defs.length, 1);
  assert.equal(defs[0].name, 'calc');
  assert.equal(defs[0].description, 'Calculator');
  assert.equal(defs[0].parameters.type, 'object');
  assert.deepEqual(defs[0].parameters.required, ['expr']);
});

// ── Built-in Tools Tests ─────────────────────────────────────────────────────

test('builtin: registers standard tools', () => {
  const reg = getToolRegistry();
  registerBuiltinTools();

  assert.ok(reg.has('search_web'));
  assert.ok(reg.has('read_page'));
  assert.ok(reg.has('open_app'));
  assert.ok(reg.has('get_system_info'));
  assert.ok(reg.has('run_command'));
  assert.ok(reg.size >= 5);
});

test('builtin: run_command requires approval', () => {
  const reg = getToolRegistry();
  registerBuiltinTools();

  assert.equal(reg.requiresApproval('run_command'), true);
  assert.equal(reg.requiresApproval('search_web'), false);
});

test('builtin: get_system_info basic execution', async () => {
  const reg = getToolRegistry();
  registerBuiltinTools();

  const raw = await reg.execute('get_system_info', { type: 'basic' });
  const info = JSON.parse(raw);
  assert.ok(info.platform);
  assert.ok(info.arch);
  assert.ok(typeof info.cpus === 'number');
});

test('builtin: get_system_info memory execution', async () => {
  const reg = getToolRegistry();
  registerBuiltinTools();

  const raw = await reg.execute('get_system_info', { type: 'memory' });
  const info = JSON.parse(raw);
  assert.ok(info.totalMemory);
  assert.ok(info.freeMemory);
});

test('builtin: open_app payload structure', async () => {
  const reg = getToolRegistry();
  registerBuiltinTools();

  const raw = await reg.execute('open_app', { target: 'YouTube' });
  const result = JSON.parse(raw);
  assert.equal(result.action, 'open_app');
  assert.equal(result.target, 'YouTube');
});
