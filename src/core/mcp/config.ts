/**
 * MCP Configuration — load mcp.json from project/user dirs.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

export interface McpServerConfig {
  /** Server name (used as prefix for tool names). */
  name: string;
  /** Transport type. */
  transport: "stdio" | "sse";
  /** Command to start the server (for stdio transport). */
  command?: string;
  /** Arguments for the command. */
  args?: string[];
  /** URL for SSE transport. */
  url?: string;
  /** Environment variables to pass to the server. */
  env?: Record<string, string>;
  /** Whether the server is enabled. */
  enabled?: boolean;
}

export interface McpConfig {
  servers: McpServerConfig[];
}

/**
 * Load MCP configuration from project and user dirs.
 * Project config overrides user config for servers with the same name.
 */
export async function loadMcpConfig(cwd: string): Promise<McpConfig> {
  const paths = [
    join(homedir(), ".openharness", "mcp.json"),
    join(homedir(), ".claude", "mcp.json"), // Claude Code user-level
    join(cwd, ".openharness", "mcp.json"),
    join(cwd, ".claude", "mcp.json"), // Claude Code project-level
    join(cwd, "mcp.json"),
  ];

  const servers = new Map<string, McpServerConfig>();

  for (const configPath of paths) {
    try {
      const content = await readFile(configPath, "utf-8");
      const config = JSON.parse(content) as McpConfig;
      if (config.servers && Array.isArray(config.servers)) {
        for (const server of config.servers) {
          if (server.name && server.transport) {
            servers.set(server.name, { enabled: true, ...server });
          }
        }
      }
    } catch {
      // Config doesn't exist — skip
    }
  }

  return { servers: Array.from(servers.values()) };
}
