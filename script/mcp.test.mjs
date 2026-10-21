// Test suite for MCP Client integration
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMCPConfig, MCPClient, getMCPClient } from '../src/lib/mcp-client.ts';
import { getToolRegistry } from '../src/lib/tool-registry.ts';

// ── MCP Config Tests ─────────────────────────────────────────────────────────

test('mcp: loadMCPConfig returns object', () => {
  const config = loadMCPConfig();
  assert.equal(typeof config, 'object');
  assert.ok(!Array.isArray(config));
});

test('mcp: client initialization', () => {
  const client = new MCPClient();
  assert.equal(client.hasConnectedServers(), false);
  assert.deepEqual(client.getServers(), []);
});

test('mcp: getMCPClient returns singleton', () => {
  const c1 = getMCPClient();
  const c2 = getMCPClient();
  assert.equal(c1, c2);
});

test('mcp: tool registration prefix pattern', () => {
  const reg = getToolRegistry();
  // Register a mock tool as if it came from MCP
  reg.register(
    'mcp_test_echo',
    '[MCP:test] Echo tool',
    { type: 'object', properties: { msg: { type: 'string' } } },
    async (args) => `mcp echo: ${args.msg}`
  );

  assert.equal(reg.has('mcp_test_echo'), true);
  assert.ok(reg.names().some((n) => n.startsWith('mcp_')));
});

test('mcp: disconnectAll cleans up state', async () => {
  const client = new MCPClient();
  await client.disconnectAll();
  assert.equal(client.hasConnectedServers(), false);
});
