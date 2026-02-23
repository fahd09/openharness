/**
 * /hooks command — View configured hooks and their status.
 */

import chalk from "chalk";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { SlashCommand, CommandContext } from "../core/commands.js";

interface HookConfig {
  event: string;
  command?: string;
  toolFilter?: string[];
}

async function loadHooksFile(path: string): Promise<HookConfig[]> {
  try {
    const content = await readFile(path, "utf-8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export const hooksCommand: SlashCommand = {
  name: "hooks",
  description: "View configured hooks",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    console.log(chalk.bold("\n  Hooks Configuration"));
    console.log(chalk.dim("  " + "─".repeat(40)));

    const sources = [
      { label: "Global", path: join(homedir(), ".claude-code-core", "hooks.json") },
      { label: "Project", path: join(ctx.cwd, ".claude-code-core", "hooks.json") },
    ];

    let totalHooks = 0;

    for (const source of sources) {
      const hooks = await loadHooksFile(source.path);
      if (hooks.length === 0) {
        console.log(chalk.dim(`\n  ${source.label}: (none)`));
        continue;
      }

      console.log(chalk.dim(`\n  ${source.label}:`));
      for (const hook of hooks) {
        const filter = hook.toolFilter ? ` [${hook.toolFilter.join(", ")}]` : "";
        const cmd = hook.command ? chalk.dim(` → ${hook.command}`) : "";
        console.log(`    ${chalk.cyan(hook.event)}${filter}${cmd}`);
        totalHooks++;
      }
    }

    console.log();
    if (totalHooks === 0) {
      console.log(chalk.dim("  No hooks configured."));
      console.log(chalk.dim("  Create ~/.claude-code-core/hooks.json or .claude-code-core/hooks.json"));
      console.log(chalk.dim("  Format: [{\"event\": \"PreToolUse\", \"command\": \"echo hello\"}]"));
    } else {
      console.log(chalk.dim(`  ${totalHooks} hook(s) configured.`));
    }
    console.log();

    return true;
  },
};
