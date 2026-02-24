/**
 * /help command — show all available commands grouped by category.
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext, CommandRegistry } from "../core/commands.js";

export function createHelpCommand(registry: CommandRegistry): SlashCommand {
  return {
    name: "help",
    description: "Show available commands",
    category: "info",
    aliases: ["h", "?"],
    async execute(_args: string, ctx: CommandContext): Promise<boolean> {
      const output = ctx.output ?? console.log;
      const commands = registry.getAll();

      const categories: Record<string, SlashCommand[]> = {
        session: [],
        model: [],
        info: [],
        tools: [],
        other: [],
      };

      for (const cmd of commands) {
        (categories[cmd.category] ?? categories.other).push(cmd);
      }

      const categoryLabels: Record<string, string> = {
        session: "Session",
        model: "Model & Config",
        info: "Information",
        tools: "Tools & Actions",
        other: "Other",
      };

      output("");
      for (const [cat, cmds] of Object.entries(categories)) {
        if (cmds.length === 0) continue;
        output(chalk.bold(`  ${categoryLabels[cat]}`));
        for (const cmd of cmds) {
          const aliases = cmd.aliases?.length
            ? chalk.dim(` (${cmd.aliases.map((a) => `/${a}`).join(", ")})`)
            : "";
          output(
            `    ${chalk.cyan(`/${cmd.name}`)}${aliases}  ${chalk.dim(cmd.description)}`
          );
        }
        output("");
      }

      output(chalk.dim("  /<skill>    Run a loaded skill (e.g., /commit)"));
      output("");

      return true;
    },
  };
}
