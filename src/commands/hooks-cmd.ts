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
    const output = ctx.output ?? console.log;
    output(chalk.bold("\n  Hooks Configuration"));
    output(chalk.dim("  " + "─".repeat(40)));

    const sources = [
      { label: "Global", path: join(homedir(), ".openharness", "hooks.json") },
      { label: "Project", path: join(ctx.cwd, ".openharness", "hooks.json") },
    ];

    let totalHooks = 0;

    for (const source of sources) {
      const hooks = await loadHooksFile(source.path);
      if (hooks.length === 0) {
        output(chalk.dim(`\n  ${source.label}: (none)`));
        continue;
      }

      output(chalk.dim(`\n  ${source.label}:`));
      for (const hook of hooks) {
        const filter = hook.toolFilter ? ` [${hook.toolFilter.join(", ")}]` : "";
        const cmd = hook.command ? chalk.dim(` → ${hook.command}`) : "";
        output(`    ${chalk.cyan(hook.event)}${filter}${cmd}`);
        totalHooks++;
      }
    }

    output("");
    if (totalHooks === 0) {
      output(chalk.dim("  No hooks configured."));
      output(chalk.dim("  Create ~/.openharness/hooks.json or .openharness/hooks.json"));
      output(chalk.dim("  Format: [{\"event\": \"PreToolUse\", \"command\": \"echo hello\"}]"));
    } else {
      output(chalk.dim(`  ${totalHooks} hook(s) configured.`));
    }
    output("");

    return true;
  },
};
