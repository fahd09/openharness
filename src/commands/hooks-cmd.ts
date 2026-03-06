/**
 * /hooks command — View and edit configured hooks.
 *
 * Subcommands:
 *   (none) / list  — Show configured hooks and config file paths
 *   edit [global]  — Open hooks config in $EDITOR
 */

import chalk from "chalk";
import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { execSync } from "child_process";
import type { SlashCommand, CommandContext } from "../core/commands.js";

interface HookConfig {
  event: string;
  command?: string;
  prompt?: string;
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

const HOOK_TEMPLATE = `[
  {
    "event": "PreToolUse",
    "command": "echo 'hook fired'",
    "toolFilter": ["Bash"]
  }
]
`;

const HOOK_EVENTS = [
  "PreToolUse", "PostToolUse", "PostToolUseFailure",
  "Notification", "UserPromptSubmit",
  "SessionStart", "SessionEnd",
  "Stop", "SubagentStop", "PreCompact",
];

export const hooksCommand: SlashCommand = {
  name: "hooks",
  description: "View and edit configured hooks",
  category: "info",
  completions: ["list", "edit"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || "list";

    const globalPath = join(homedir(), ".openharness", "hooks.json");
    const projectPath = join(ctx.cwd, ".openharness", "hooks.json");

    // ── edit subcommand ──────────────────────────────────────────────
    if (subcommand === "edit") {
      const scope = parts[1]?.toLowerCase();
      const targetPath = scope === "global" ? globalPath : projectPath;
      const label = scope === "global" ? "Global" : "Project";

      const editor = process.env.VISUAL || process.env.EDITOR || "vi";

      // Create file with template if it doesn't exist
      if (!existsSync(targetPath)) {
        await mkdir(dirname(targetPath), { recursive: true });
        await writeFile(targetPath, HOOK_TEMPLATE, "utf-8");
        output(chalk.dim(`  Created ${targetPath} with starter template.`));
      }

      output(chalk.dim(`  Opening ${label} hooks in ${editor}...`));
      try {
        execSync(`${editor} "${targetPath}"`, { stdio: "inherit" });
        output(chalk.green("  Hooks file saved. Restart session to apply changes."));
      } catch {
        output(chalk.yellow(`  Could not open editor. Edit manually:`));
        output(`  ${chalk.cyan(targetPath)}`);
      }
      output("");
      return true;
    }

    // ── list subcommand (default) ────────────────────────────────────
    output(chalk.bold("\n  Hooks Configuration"));
    output(chalk.dim("  " + "─".repeat(50)));

    const sources = [
      { label: "Global", path: globalPath },
      { label: "Project", path: projectPath },
    ];

    let totalHooks = 0;

    for (const source of sources) {
      const hooks = await loadHooksFile(source.path);
      if (hooks.length === 0) {
        output(`\n  ${chalk.dim(source.label + ":")} ${chalk.dim("(none)")}`);
        output(`  ${chalk.dim(source.path)}`);
        continue;
      }

      output(`\n  ${chalk.bold(source.label + ":")} ${chalk.dim(source.path)}`);
      for (const hook of hooks) {
        const filter = hook.toolFilter ? chalk.dim(` [${hook.toolFilter.join(", ")}]`) : "";
        const type = hook.prompt ? chalk.magenta("prompt") : hook.command ? chalk.blue("cmd") : chalk.dim("?");
        const detail = hook.command
          ? chalk.dim(` → ${hook.command.length > 40 ? hook.command.slice(0, 37) + "..." : hook.command}`)
          : hook.prompt
            ? chalk.dim(` → "${hook.prompt.slice(0, 30)}${hook.prompt.length > 30 ? "..." : ""}"`)
            : "";
        output(`    ${chalk.cyan(hook.event)}${filter} ${type}${detail}`);
        totalHooks++;
      }
    }

    output("");
    if (totalHooks === 0) {
      output(chalk.dim("  No hooks configured."));
      output("");
      output(chalk.dim("  Hook events: ") + HOOK_EVENTS.map(e => chalk.cyan(e)).join(chalk.dim(", ")));
      output("");
      output(chalk.dim("  Quick start:"));
      output(chalk.dim(`    /hooks edit          — edit project hooks`));
      output(chalk.dim(`    /hooks edit global   — edit global hooks`));
    } else {
      output(chalk.dim(`  ${totalHooks} hook(s) configured.`));
      output("");
      output(chalk.dim(`  /hooks edit          — edit project hooks`));
      output(chalk.dim(`  /hooks edit global   — edit global hooks`));
    }
    output("");

    return true;
  },
};
