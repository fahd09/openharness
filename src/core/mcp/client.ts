/**
 * MCP Client — JSON-RPC client for Model Context Protocol servers.
 *
 * Handles tool discovery, execution, and lifecycle management.
 * Tools are registered as mcp__serverName__toolName to avoid collisions.
 */

import type { McpTransport, JsonRpcRequest, JsonRpcResponse } from "./transport.js";
import { StdioTransport, SseTransport } from "./transport.js";
import type { McpServerConfig } from "./config.js";
import type { Tool, ToolOutput, ToolContext } from "../../tools/tool-registry.js";
import { z } from "zod";

// ── MCP Tool Schema ─────────────────────────────────────────────────

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

// ── MCP Client ──────────────────────────────────────────────────────

export class McpClient {
  private transport: McpTransport | null = null;
  private nextId = 1;
  private serverName: string;
  private tools: McpToolDefinition[] = [];

  constructor(private config: McpServerConfig) {
    this.serverName = config.name;
  }

  /**
   * Connect to the MCP server and discover tools.
   */
  async connect(): Promise<void> {
    // Create transport based on config
    if (this.config.transport === "stdio") {
      if (!this.config.command) {
        throw new Error(`MCP server ${this.serverName}: missing command for stdio transport`);
      }
      const transport = new StdioTransport(
        this.config.command,
        this.config.args ?? [],
        this.config.env ?? {}
      );
      await transport.start();
      this.transport = transport;
    } else if (this.config.transport === "sse") {
      if (!this.config.url) {
        throw new Error(`MCP server ${this.serverName}: missing url for SSE transport`);
      }
      const transport = new SseTransport(this.config.url);
      await transport.start();
      this.transport = transport;
    } else {
      throw new Error(`MCP server ${this.serverName}: unknown transport "${this.config.transport}"`);
    }

    // Initialize the connection
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "claude-code-core",
        version: "0.1.0",
      },
    });

    // Notify initialized
    await this.transport.notify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });

    // Discover tools
    const toolsResponse = await this.request("tools/list", {});
    if (toolsResponse.result && typeof toolsResponse.result === "object") {
      const result = toolsResponse.result as { tools?: McpToolDefinition[] };
      this.tools = result.tools ?? [];
    }
  }

  /**
   * Send a JSON-RPC request.
   */
  private async request(method: string, params?: unknown): Promise<JsonRpcResponse> {
    if (!this.transport) {
      throw new Error(`MCP server ${this.serverName}: not connected`);
    }

    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: this.nextId++,
      method,
      params,
    };

    return this.transport.send(request);
  }

  /**
   * Execute a tool by its MCP name.
   */
  async executeTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    const response = await this.request("tools/call", {
      name: toolName,
      arguments: args,
    });

    if (response.error) {
      throw new Error(`MCP tool error: ${response.error.message}`);
    }

    // Extract text from the result
    const result = response.result as {
      content?: Array<{ type: string; text?: string }>;
    };

    if (result?.content) {
      return result.content
        .filter((c) => c.type === "text" && c.text)
        .map((c) => c.text!)
        .join("\n");
    }

    return JSON.stringify(response.result);
  }

  /**
   * Convert MCP tools to the internal Tool interface.
   * Tools are named mcp__serverName__toolName.
   */
  getToolAdapters(): Tool[] {
    return this.tools.map((mcpTool) => this.createToolAdapter(mcpTool));
  }

  private createToolAdapter(mcpTool: McpToolDefinition): Tool {
    const prefixedName = `mcp__${this.serverName}__${mcpTool.name}`;
    const client = this;

    // Build a Zod schema from the MCP JSON schema
    const zodShape: Record<string, z.ZodTypeAny> = {};
    const props = mcpTool.inputSchema.properties ?? {};
    const required = new Set(mcpTool.inputSchema.required ?? []);

    for (const [key, schema] of Object.entries(props)) {
      const s = schema as { type?: string; description?: string };
      let field: z.ZodTypeAny;

      switch (s.type) {
        case "number":
        case "integer":
          field = z.number();
          break;
        case "boolean":
          field = z.boolean();
          break;
        case "array":
          field = z.array(z.unknown());
          break;
        case "object":
          field = z.record(z.unknown());
          break;
        default:
          field = z.string();
      }

      if (s.description) {
        field = field.describe(s.description);
      }

      if (!required.has(key)) {
        field = field.optional();
      }

      zodShape[key] = field;
    }

    return {
      name: prefixedName,
      description: `[MCP: ${this.serverName}] ${mcpTool.description}`,
      inputSchema: z.object(zodShape),
      maxResultSizeChars: 100_000,
      isReadOnly: () => false,
      isConcurrencySafe: () => false,
      async *call(
        input: unknown,
        _context: ToolContext
      ): AsyncGenerator<ToolOutput> {
        const result = await client.executeTool(
          mcpTool.name,
          input as Record<string, unknown>
        );
        yield { type: "result", content: result };
      },
    };
  }

  /**
   * Get the server name.
   */
  getName(): string {
    return this.serverName;
  }

  /**
   * Get discovered tool count.
   */
  getToolCount(): number {
    return this.tools.length;
  }

  /**
   * Disconnect from the server.
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
    }
  }

  /**
   * Check if connected.
   */
  isConnected(): boolean {
    return this.transport?.isConnected() ?? false;
  }
}
