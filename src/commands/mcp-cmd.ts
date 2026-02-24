/**
 * /mcp command — MCP server manager.
 */

import chalk from "chalk";
import { join } from "path";
import { homedir } from "os";
import {
  loadMcpConfig,
  saveMcpServer,
  removeMcpServer,
  getMcpClients,
  initializeMcpServers,
  disconnectMcpServers,
  type McpServerConfig,
} from "../core/mcp/index.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const mcpCommand: SlashCommand = {
  name: "mcp",
  description: "Manage MCP servers (list, add, remove, reload)",
  category: "tools",
  completions: ["list", "add", "remove", "enable", "disable", "reload"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || "list";
    const serverName = parts.slice(1).join(" ");

    if (subcommand === "list" || subcommand === "") {
      const config = await loadMcpConfig(ctx.cwd);
      const clients = getMcpClients();

      output(chalk.bold("\n  MCP Servers"));
      output(chalk.dim("  " + "─".repeat(50)));

      if (config.servers.length === 0) {
        output(chalk.dim("  No MCP servers configured."));
        output(chalk.dim("  Use /mcp add to configure a server."));
        output("");
        return true;
      }

      for (const server of config.servers) {
        const enabled = server.enabled !== false;
        const statusIcon = enabled ? chalk.green("●") : chalk.dim("○");
        const client = clients.find((c) => c.getName() === server.name);
        const connected = client ? chalk.green("connected") : chalk.dim("disconnected");
        const toolCount = client ? ` (${client.getToolAdapters().length} tools)` : "";
        const transport = server.transport === "sse" ? server.url : server.command;

        output(`  ${statusIcon} ${chalk.bold(server.name)} ${connected}${toolCount}`);
        output(chalk.dim(`    ${server.transport}: ${transport}`));
      }

      output("");
      return true;
    }

    if (subcommand === "add") {
      if (!ctx.dispatch) {
        output(chalk.yellow("Interactive /mcp add requires Ink mode."));
        return true;
      }

      // Step 1: Server name
      const name = await wizardText(ctx, "Add MCP Server", "Server name", "my-server");
      if (!name) { output(chalk.dim("Cancelled.")); return true; }

      // Step 2: Transport type
      const transport = await wizardSelect(ctx, "Add MCP Server", "Transport type", [
        { id: "stdio", label: "stdio", description: "Local process (command + args)" },
        { id: "sse", label: "sse", description: "Remote server (URL)" },
      ]);
      if (!transport) { output(chalk.dim("Cancelled.")); return true; }

      // Step 3: Command/URL
      let command: string | undefined;
      let url: string | undefined;
      let cmdArgs: string[] = [];

      if (transport === "stdio") {
        const cmdInput = await wizardText(ctx, "Add MCP Server", "Command (e.g., npx -y @mcp/server)", "npx -y @mcp/server");
        if (!cmdInput) { output(chalk.dim("Cancelled.")); return true; }
        const cmdParts = cmdInput.split(/\s+/);
        command = cmdParts[0];
        cmdArgs = cmdParts.slice(1);
      } else {
        const urlInput = await wizardText(ctx, "Add MCP Server", "Server URL", "http://localhost:3000/sse");
        if (!urlInput) { output(chalk.dim("Cancelled.")); return true; }
        url = urlInput;
      }

      // Step 4: Scope
      const scope = await wizardSelect(ctx, "Add MCP Server", "Configuration scope", [
        { id: "project", label: "Project", description: `.openharness/mcp.json in ${ctx.cwd}` },
        { id: "global", label: "Global", description: "~/.openharness/mcp.json" },
      ]);
      if (!scope) { output(chalk.dim("Cancelled.")); return true; }

      const configPath = scope === "global"
        ? join(homedir(), ".openharness", "mcp.json")
        : join(ctx.cwd, ".openharness", "mcp.json");

      const serverConfig: McpServerConfig = {
        name,
        transport: transport as "stdio" | "sse",
        ...(command ? { command, args: cmdArgs } : {}),
        ...(url ? { url } : {}),
        enabled: true,
      };

      await saveMcpServer(configPath, serverConfig);
      output(chalk.green(`Added MCP server "${name}" to ${configPath}`));
      output(chalk.dim("Use /mcp reload to connect."));
      return true;
    }

    if (subcommand === "remove") {
      if (!serverName) {
        output(chalk.red("Usage: /mcp remove <server-name>"));
        return true;
      }
      // Try removing from all known config paths
      const paths = [
        join(ctx.cwd, ".openharness", "mcp.json"),
        join(ctx.cwd, ".claude", "mcp.json"),
        join(homedir(), ".openharness", "mcp.json"),
        join(homedir(), ".claude", "mcp.json"),
      ];
      let removed = false;
      for (const p of paths) {
        if (await removeMcpServer(p, serverName)) {
          removed = true;
          output(chalk.green(`Removed "${serverName}" from ${p}`));
        }
      }
      if (!removed) {
        output(chalk.yellow(`Server "${serverName}" not found in any config file.`));
      }
      return true;
    }

    if (subcommand === "enable" || subcommand === "disable") {
      if (!serverName) {
        output(chalk.red(`Usage: /mcp ${subcommand} <server-name>`));
        return true;
      }
      const config = await loadMcpConfig(ctx.cwd);
      const server = config.servers.find((s) => s.name === serverName);
      if (!server) {
        output(chalk.yellow(`Server "${serverName}" not found.`));
        return true;
      }
      server.enabled = subcommand === "enable";
      // Save to project config
      const configPath = join(ctx.cwd, ".openharness", "mcp.json");
      await saveMcpServer(configPath, server);
      output(chalk.green(`Server "${serverName}" ${subcommand}d.`));
      output(chalk.dim("Use /mcp reload to apply changes."));
      return true;
    }

    if (subcommand === "reload") {
      output(chalk.dim("Disconnecting MCP servers..."));
      await disconnectMcpServers();

      output(chalk.dim("Reconnecting..."));
      const mcpTools = await initializeMcpServers(ctx.cwd);
      for (const tool of mcpTools) {
        ctx.toolRegistry.register(tool);
      }
      output(chalk.green(`Reloaded: ${mcpTools.length} tools from MCP servers.`));
      return true;
    }

    output(chalk.yellow(`Unknown subcommand: ${subcommand}. Use list, add, remove, enable, disable, or reload.`));
    return true;
  },
};

// ── Wizard Helpers ──────────────────────────────────────────────────

async function wizardText(
  ctx: CommandContext,
  title: string,
  header: string,
  placeholder: string,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    ctx.dispatch!({
      type: "WIZARD_STEP",
      title,
      step: { type: "text", header, placeholder },
      resolve: (result) => resolve(typeof result === "string" ? result : null),
    });
  });
}

async function wizardSelect(
  ctx: CommandContext,
  title: string,
  header: string,
  items: Array<{ id: string; label: string; description?: string }>,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    ctx.dispatch!({
      type: "WIZARD_STEP",
      title,
      step: { type: "select", header, items },
      resolve: (result) => resolve(typeof result === "string" ? result : null),
    });
  });
}
