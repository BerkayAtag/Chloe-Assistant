/**
 * MCP (Model Context Protocol) Client — Integration for local MCP servers
 *
 * Source pattern: https://github.com/modelcontextprotocol/typescript-sdk
 * License: MIT
 *
 * Discovers local MCP servers from ~/.mcp/servers.json and registers their
 * tools to the universal ToolRegistry.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { getToolRegistry, type ToolDefinition } from './tool-registry.ts';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServerInfo {
  name: string;
  config: MCPServerConfig;
  connected: boolean;
  tools: ToolDefinition[];
}

const MCP_CONFIG_PATH = path.join(os.homedir(), '.mcp', 'servers.json');

/**
 * Load MCP server configurations from ~/.mcp/servers.json
 */
export function loadMCPConfig(): Record<string, MCPServerConfig> {
  try {
    if (!fs.existsSync(MCP_CONFIG_PATH)) return {};
    const raw = fs.readFileSync(MCP_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * MCP Client wrapper for Chloe
 */
export class MCPClient {
  private clients: Map<string, Client> = new Map();
  private servers: Map<string, MCPServerInfo> = new Map();

  /**
   * Connect to all configured MCP servers and register their tools
   */
  async connectAll(): Promise<void> {
    const configs = loadMCPConfig();
    for (const [name, config] of Object.entries(configs)) {
      await this.connect(name, config);
    }
  }

  /**
   * Connect to a single MCP server
   */
  async connect(name: string, config: MCPServerConfig): Promise<void> {
    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: config.env,
      });

      const client = new Client({ name: `chloe-${name}`, version: '0.2.7' }, { capabilities: {} });
      await client.connect(transport);

      // List available tools from this server
      const { tools } = await client.listTools();
      const toolDefs: ToolDefinition[] = tools.map((t) => ({
        name: t.name,
        description: t.description || `MCP tool: ${t.name}`,
        parameters: t.inputSchema as ToolDefinition['parameters'],
      }));

      // Register each tool to the global registry
      const registry = getToolRegistry();
      for (const tool of toolDefs) {
        registry.register(
          `mcp_${name}_${tool.name}`,
          `[MCP:${name}] ${tool.description}`,
          tool.parameters,
          async (args) => {
            const result = await client.callTool({ name: tool.name, arguments: args });
            return typeof result === 'string' ? result : JSON.stringify(result);
          }
        );
      }

      this.clients.set(name, client);
      this.servers.set(name, { name, config, connected: true, tools: toolDefs });
    } catch (error) {
      this.servers.set(name, {
        name,
        config,
        connected: false,
        tools: [],
      });
      console.error(`MCP server "${name}" connection failed:`, error);
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients.entries()) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.servers.clear();
  }

  /**
   * Get list of connected MCP servers
   */
  getServers(): MCPServerInfo[] {
    return Array.from(this.servers.values());
  }

  /**
   * Check if any MCP servers are connected
   */
  hasConnectedServers(): boolean {
    return Array.from(this.servers.values()).some((s) => s.connected);
  }
}

/**
 * Global MCP client instance
 */
let globalMCPClient: MCPClient | null = null;

export function getMCPClient(): MCPClient {
  if (!globalMCPClient) {
    globalMCPClient = new MCPClient();
  }
  return globalMCPClient;
}

/**
 * Initialize MCP client and connect to all configured servers
 */
export async function initializeMCP(): Promise<void> {
  const client = getMCPClient();
  await client.connectAll();
}
