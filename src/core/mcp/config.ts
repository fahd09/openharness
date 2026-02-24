/**
 * MCP Configuration — load mcp.json from project/user dirs.
 */

import { readFile, writeFile, mkdir } from "fs/promises";
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

/**
 * Save an MCP server config to a specific config file.
 * Adds or replaces a server by name.
 */
export async function saveMcpServer(configPath: string, server: McpServerConfig): Promise<void> {
  let config: McpConfig = { servers: [] };
  try {
    const content = await readFile(configPath, "utf-8");
    config = JSON.parse(content) as McpConfig;
    if (!Array.isArray(config.servers)) config.servers = [];
  } catch {
    // File doesn't exist — start fresh
  }

  const idx = config.servers.findIndex((s) => s.name === server.name);
  if (idx >= 0) {
    config.servers[idx] = server;
  } else {
    config.servers.push(server);
  }

  const dir = join(configPath, "..");
  await mkdir(dir, { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

/**
 * Remove an MCP server from a config file by name.
 */
export async function removeMcpServer(configPath: string, serverName: string): Promise<boolean> {
  let config: McpConfig;
  try {
    const content = await readFile(configPath, "utf-8");
    config = JSON.parse(content) as McpConfig;
    if (!Array.isArray(config.servers)) return false;
  } catch {
    return false;
  }

  const idx = config.servers.findIndex((s) => s.name === serverName);
  if (idx < 0) return false;

  config.servers.splice(idx, 1);
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return true;
}
