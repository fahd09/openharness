/**
 * /plugin command — manage plugins.
 */

import chalk from "chalk";
import { getPluginManager } from "../core/plugins/index.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const pluginCommand: SlashCommand = {
  name: "plugin",
  description: "Manage plugins (list/install/enable/disable)",
  category: "tools",
  completions: ["list", "install", "enable", "disable"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0]?.toLowerCase() || "list";
    const target = parts[1];
    const manager = getPluginManager();

    switch (subcommand) {
      case "list": {
        const plugins = manager.list();
        if (plugins.length === 0) {
          output(chalk.dim("No plugins installed."));
          output(
            chalk.dim(
              "Place plugin directories in ~/.openharness/plugins/"
            )
          );
        } else {
          output(chalk.dim("\nPlugins:"));
          for (const p of plugins) {
            const status = p.enabled
              ? chalk.green("enabled")
              : chalk.dim("disabled");
            const tag = p.builtin ? chalk.dim(" [built-in]") : "";
            output(`  ${chalk.cyan(p.name)} ${status}${tag} — ${p.description}`);
          }
        }
        output();
        break;
      }

      case "install": {
        if (!target) {
          output(chalk.dim("Usage: /plugin install <path-or-name>"));
          break;
        }
        try {
          await manager.install(target);
          output(chalk.dim(`Plugin installed: ${target}`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          output(chalk.red(`Install failed: ${msg}`));
        }
        break;
      }

      case "enable": {
        if (!target) {
          output(chalk.dim("Usage: /plugin enable <name>"));
          break;
        }
        manager.enable(target);
        output(chalk.dim(`Plugin enabled: ${target}`));
        break;
      }

      case "disable": {
        if (!target) {
          output(chalk.dim("Usage: /plugin disable <name>"));
          break;
        }
        manager.disable(target);
        output(chalk.dim(`Plugin disabled: ${target}`));
        break;
      }

      default:
        output(chalk.dim("Usage: /plugin [list|install|enable|disable] [name]"));
    }

    return true;
  },
};
