/**
 * Universal Tool Registry — Port of Jarvis AI Assistant's tool management
 *
 * Source: https://github.com/akshayaggarwal99/jarvis-ai-assistant
 *   src/tools/tool-registry.ts
 * License: MIT
 *
 * Provides a unified registry for tools that can be called by LLM function calling,
 * agent office workers, or CLI/voice commands.
 */

// Tool definition for LLM function calling (OpenAI-compatible)
export interface ToolParameter {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export type ToolExecutor = (args: Record<string, unknown>) => Promise<string>;

interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
  /** Whether this tool requires user approval before execution. */
  requiresApproval?: boolean;
}

/**
 * Universal Tool Registry manages all available tools
 */
export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a new tool
   */
  register(
    name: string,
    description: string,
    parameters: ToolDefinition['parameters'],
    executor: ToolExecutor,
    options?: { requiresApproval?: boolean }
  ): void {
    this.tools.set(name, {
      definition: { name, description, parameters },
      executor,
      requiresApproval: options?.requiresApproval ?? false,
    });
  }

  /**
   * Get all tool definitions for LLM function calling
   */
  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Execute a tool by name with arguments
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Bilinmeyen araç: "${name}"`);
    }
    return await tool.executor(args);
  }

  /**
   * Check if tool requires approval
   */
  requiresApproval(name: string): boolean {
    return this.tools.get(name)?.requiresApproval ?? false;
  }

  /**
   * Get tool count
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * List all tool names
   */
  names(): string[] {
    return Array.from(this.tools.keys());
  }
}

/**
 * Global default registry instance
 */
let defaultRegistry: ToolRegistry | null = null;

export function getToolRegistry(): ToolRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new ToolRegistry();
  }
  return defaultRegistry;
}
