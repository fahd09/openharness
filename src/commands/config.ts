/**
 * /config command — View and edit settings.
 *
 * Shows current configuration from environment variables and config files.
 * With arguments, opens the config file in the user's editor.
 */

import chalk from "chalk";
import { readFile, access, constants } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { execFile } from "child_process";
import type { SlashCommand, CommandContext } from "../core/commands.js";

const CONFIG_DIR = join(homedir(), ".claude-code-core");

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function loadJsonConfig(path: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function openInEditor(filePath: string): void {
  const editor = process.env.EDITOR || process.env.VISUAL || "vi";
  const child = execFile(editor, [filePath], {
    stdio: "inherit",
    env: process.env,
  } as any);
  child.unref();
}

export const configCommand: SlashCommand = {
  name: "config",
  description: "View or edit settings",
  category: "model",
  aliases: ["settings"],
  completions: ["edit"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    if (args === "edit") {
      const settingsPath = join(CONFIG_DIR, "settings.json");
      console.log(chalk.dim(`Opening ${settingsPath} in editor...`));
      openInEditor(settingsPath);
      return true;
    }

    console.log(chalk.bold("\n  Configuration"));
    console.log(chalk.dim("  " + "─".repeat(40)));

    // Provider & Model
    const provider = (process.env.LLM_PROVIDER || "anthropic").toLowerCase();
    console.log(chalk.dim(`  Provider:        ${provider}`));
    console.log(chalk.dim(`  Model:           ${ctx.model}`));
    console.log(chalk.dim(`  Permission mode: ${ctx.permissionMode}`));

    // API Keys (masked)
    if (provider === "anthropic") {
      const key = process.env.ANTHROPIC_API_KEY;
      console.log(chalk.dim(`  API Key:         ${key ? "sk-..." + key.slice(-4) : chalk.red("not set")}`));
    } else {
      const key = process.env.OPENAI_API_KEY;
      console.log(chalk.dim(`  API Key:         ${key ? "sk-..." + key.slice(-4) : chalk.red("not set")}`));
      if (process.env.OPENAI_BASE_URL) {
        console.log(chalk.dim(`  Base URL:        ${process.env.OPENAI_BASE_URL}`));
      }
    }

    // Thinking budget
    const thinkingBudget = process.env.CLAUDE_CODE_THINKING_BUDGET;
    if (thinkingBudget) {
      console.log(chalk.dim(`  Thinking budget: ${thinkingBudget} tokens`));
    }

    // Config files
    console.log();
    console.log(chalk.dim("  Config files:"));

    const configFiles = [
      { name: "settings.json", path: join(CONFIG_DIR, "settings.json") },
      { name: "hooks.json (global)", path: join(CONFIG_DIR, "hooks.json") },
      { name: "hooks.json (project)", path: join(ctx.cwd, ".claude-code-core", "hooks.json") },
      { name: "mcp.json (global)", path: join(CONFIG_DIR, "mcp.json") },
      { name: "mcp.json (project)", path: join(ctx.cwd, "mcp.json") },
      { name: "CLAUDE.md", path: join(ctx.cwd, "CLAUDE.md") },
    ];

    for (const file of configFiles) {
      const exists = await fileExists(file.path);
      const icon = exists ? chalk.green("✓") : chalk.dim("·");
      console.log(`    ${icon} ${chalk.dim(file.name)}`);
    }

    console.log();
    console.log(chalk.dim("  Use /config edit to open settings.json in your editor."));
    console.log();

    return true;
  },
};
