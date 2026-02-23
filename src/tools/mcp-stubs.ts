/**
 * MCP Tool Stubs — specs for future MCP (Model Context Protocol) implementation.
 *
 * These are placeholder tools that define the interface but return
 * "not implemented" messages. They document the expected behavior
 * for when MCP support is added.
 *
 * 3 tools:
 * - ListMcpResources: List available MCP server resources
 * - ReadMcpResource: Read a specific MCP resource
 * - Mcp: Execute an MCP tool on a connected server
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

// ── ListMcpResources ─────────────────────────────────────────────────

const listMcpResourcesSchema = z.object({
  server: z
    .string()
    .optional()
    .describe("MCP server name to list resources from (lists all if omitted)"),
});

export const listMcpResourcesTool: Tool = {
  name: "ListMcpResources",
  description:
    "List available resources from connected MCP servers. Returns resource URIs and descriptions.",
  inputSchema: listMcpResourcesSchema,
  maxResultSizeChars: 50000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(_rawInput: unknown, _context: ToolContext) {
    yield {
      type: "result",
      content: "MCP support is not yet implemented. To add MCP servers, configure them in ~/.claude-code-core/mcp.json",
    };
  },
};

// ── ReadMcpResource ──────────────────────────────────────────────────

const readMcpResourceSchema = z.object({
  uri: z.string().describe("The MCP resource URI to read"),
  server: z
    .string()
    .optional()
    .describe("MCP server name (auto-detected from URI if omitted)"),
});

export const readMcpResourceTool: Tool = {
  name: "ReadMcpResource",
  description:
    "Read content from a specific MCP resource by URI.",
  inputSchema: readMcpResourceSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => true,
  isReadOnly: () => true,

  async *call(_rawInput: unknown, _context: ToolContext) {
    yield {
      type: "result",
      content: "MCP support is not yet implemented. To add MCP servers, configure them in ~/.claude-code-core/mcp.json",
    };
  },
};

// ── Mcp (Execute Tool) ──────────────────────────────────────────────

const mcpToolSchema = z.object({
  server: z.string().describe("The MCP server name to execute the tool on"),
  tool: z.string().describe("The tool name to execute"),
  arguments: z
    .record(z.unknown())
    .optional()
    .describe("Arguments to pass to the MCP tool"),
});

export const mcpTool: Tool = {
  name: "Mcp",
  description:
    "Execute a tool on a connected MCP server. Use ListMcpResources first to discover available tools.",
  inputSchema: mcpToolSchema,
  maxResultSizeChars: 100000,
  isConcurrencySafe: () => false,
  isReadOnly: () => false,

  async *call(_rawInput: unknown, _context: ToolContext) {
    yield {
      type: "result",
      content: "MCP support is not yet implemented. To add MCP servers, configure them in ~/.claude-code-core/mcp.json",
    };
  },
};
