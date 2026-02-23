/**
 * MCP System — barrel export and initialization.
 */

export { McpClient } from "./client.js";
export { loadMcpConfig, type McpServerConfig, type McpConfig } from "./config.js";
export {
  StdioTransport,
  SseTransport,
  type McpTransport,
  type JsonRpcRequest,
  type JsonRpcResponse,
} from "./transport.js";

import { McpClient } from "./client.js";
import { loadMcpConfig } from "./config.js";
import type { Tool } from "../../tools/tool-registry.js";

// Active MCP clients
const clients: McpClient[] = [];

/**
 * Initialize MCP servers from config and discover tools.
 * Returns adapted Tool instances for registration.
 */
export async function initializeMcpServers(cwd: string): Promise<Tool[]> {
  const config = await loadMcpConfig(cwd);
  const tools: Tool[] = [];

  for (const serverConfig of config.servers) {
    if (serverConfig.enabled === false) continue;

    const client = new McpClient(serverConfig);
    try {
      await client.connect();
      clients.push(client);
      tools.push(...client.getToolAdapters());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`MCP server ${serverConfig.name} failed to connect: ${msg}`);
    }
  }

  return tools;
}

/**
 * Disconnect all MCP servers.
 */
export async function disconnectMcpServers(): Promise<void> {
  for (const client of clients) {
    try {
      await client.disconnect();
    } catch {
      // Best effort
    }
  }
  clients.length = 0;
}

/**
 * Get all active MCP clients.
 */
export function getMcpClients(): McpClient[] {
  return [...clients];
}
