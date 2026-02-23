/**
 * /doctor command — run environment diagnostics.
 *
 * Checks: Node.js, API key, required tools, optional tools, CLAUDE.md,
 * write access, network connectivity, MCP servers, plugins.
 */

import chalk from "chalk";
import { execFile } from "child_process";
import { access, constants } from "fs/promises";
import { join } from "path";
import type { SlashCommand, CommandContext } from "../core/commands.js";

async function checkCommand(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("which", [cmd], (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

async function getVersion(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (error, stdout) => {
      if (error) resolve(null);
      else resolve(stdout.trim().split("\n")[0]);
    });
  });
}

async function checkNetwork(host: string, timeout: number = 5000): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`https://${host}`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

export const doctorCommand: SlashCommand = {
  name: "doctor",
  description: "Run environment diagnostics",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    console.log(chalk.bold("\n  Environment Diagnostics"));
    console.log(chalk.dim("  " + "─".repeat(40)));

    const checks: Array<{ label: string; status: "ok" | "warn" | "error"; detail: string }> = [];

    // Node.js version
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1), 10);
    checks.push({
      label: "Node.js",
      status: nodeMajor >= 18 ? "ok" : "error",
      detail: `${nodeVersion}${nodeMajor < 18 ? " (requires >= 18)" : ""}`,
    });

    // API key
    const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
    if (provider === "anthropic") {
      const hasKey = !!process.env.ANTHROPIC_API_KEY;
      checks.push({
        label: "ANTHROPIC_API_KEY",
        status: hasKey ? "ok" : "error",
        detail: hasKey ? "Set" : "Not set",
      });
    } else {
      const hasKey = !!process.env.OPENAI_API_KEY;
      checks.push({
        label: "OPENAI_API_KEY",
        status: hasKey ? "ok" : "error",
        detail: hasKey ? "Set" : "Not set",
      });
    }

    // ripgrep (required for Grep tool)
    const rgPath = await checkCommand("rg");
    checks.push({
      label: "ripgrep (rg)",
      status: rgPath ? "ok" : "error",
      detail: rgPath ? "Installed" : "Not found — Grep tool will not work",
    });

    // git
    const gitPath = await checkCommand("git");
    if (gitPath) {
      const gitVersion = await getVersion("git", ["--version"]);
      checks.push({
        label: "git",
        status: "ok",
        detail: gitVersion ?? "Installed",
      });
    } else {
      checks.push({
        label: "git",
        status: "warn",
        detail: "Not found — git operations will fail",
      });
    }

    // Optional tools
    for (const cmd of ["fd", "jq", "gh", "bat"]) {
      const path = await checkCommand(cmd);
      checks.push({
        label: cmd,
        status: path ? "ok" : "warn",
        detail: path ? "Installed" : "Not found (optional)",
      });
    }

    // CLAUDE.md
    const claudeMdPath = join(ctx.cwd, "CLAUDE.md");
    try {
      await access(claudeMdPath, constants.R_OK);
      checks.push({ label: "CLAUDE.md", status: "ok", detail: "Found" });
    } catch {
      checks.push({
        label: "CLAUDE.md",
        status: "warn",
        detail: "Not found (optional — use /init to create)",
      });
    }

    // Write permissions
    try {
      await access(ctx.cwd, constants.W_OK);
      checks.push({ label: "Write access", status: "ok", detail: ctx.cwd });
    } catch {
      checks.push({
        label: "Write access",
        status: "error",
        detail: `No write permission to ${ctx.cwd}`,
      });
    }

    // Network connectivity
    console.log(chalk.dim("\n  Checking network..."));
    if (provider === "anthropic") {
      const reachable = await checkNetwork("api.anthropic.com");
      checks.push({
        label: "Network (api.anthropic.com)",
        status: reachable ? "ok" : "error",
        detail: reachable ? "Reachable" : "Cannot reach API endpoint",
      });
    } else {
      const baseUrl = process.env.OPENAI_BASE_URL ?? "api.openai.com";
      const host = baseUrl.replace(/^https?:\/\//, "").split("/")[0];
      const reachable = await checkNetwork(host);
      checks.push({
        label: `Network (${host})`,
        status: reachable ? "ok" : "error",
        detail: reachable ? "Reachable" : "Cannot reach API endpoint",
      });
    }

    // MCP servers
    const mcpToolCount = ctx.toolRegistry.getAll().filter((t) => t.name.startsWith("mcp__")).length;
    if (mcpToolCount > 0) {
      checks.push({
        label: "MCP servers",
        status: "ok",
        detail: `${mcpToolCount} tools from MCP servers`,
      });
    } else {
      checks.push({
        label: "MCP servers",
        status: "warn",
        detail: "No MCP servers configured (optional)",
      });
    }

    // Plugins
    try {
      const { getPluginManager } = await import("../core/plugins/index.js");
      const pm = getPluginManager();
      const plugins = pm.list();
      const enabledCount = plugins.filter((p) => p.enabled).length;
      if (plugins.length > 0) {
        checks.push({
          label: "Plugins",
          status: "ok",
          detail: `${enabledCount}/${plugins.length} enabled`,
        });
      } else {
        checks.push({
          label: "Plugins",
          status: "warn",
          detail: "No plugins installed (optional)",
        });
      }
    } catch {
      checks.push({
        label: "Plugins",
        status: "warn",
        detail: "Plugin system not initialized",
      });
    }

    // Display results
    // Clear the "Checking network..." line
    process.stdout.write("\x1b[1A\x1b[K");

    for (const check of checks) {
      const icon =
        check.status === "ok"
          ? chalk.green("✓")
          : check.status === "warn"
            ? chalk.yellow("⚠")
            : chalk.red("✗");
      console.log(`  ${icon} ${chalk.dim(check.label)}: ${check.detail}`);
    }

    const errors = checks.filter((c) => c.status === "error").length;
    const warnings = checks.filter((c) => c.status === "warn").length;
    console.log();
    if (errors > 0) {
      console.log(chalk.red(`  ${errors} error(s) found. Fix these for full functionality.`));
    } else if (warnings > 0) {
      console.log(chalk.yellow(`  ${warnings} warning(s). Everything should work fine.`));
    } else {
      console.log(chalk.green("  All checks passed!"));
    }
    console.log();

    return true;
  },
};
