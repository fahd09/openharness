/**
 * /feedback and /bug commands — Submit feedback or report a bug.
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const feedbackCommand: SlashCommand = {
  name: "feedback",
  description: "Submit feedback or report a bug",
  category: "other",
  aliases: ["bug"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    output(chalk.bold("\n  Feedback & Bug Reports"));
    output(chalk.dim("  " + "─".repeat(40)));
    output("");

    if (args) {
      output(chalk.dim("  Thank you for your feedback!"));
      output(chalk.dim(`  "${args}"`));
      output("");
      output(chalk.dim("  To file a formal report, please visit:"));
    } else {
      output(chalk.dim("  To report issues or provide feedback:"));
    }

    output(chalk.cyan("  https://github.com/anthropics/claude-code/issues"));
    output("");
    output(chalk.dim("  When reporting bugs, please include:"));
    output(chalk.dim("    - Steps to reproduce"));
    output(chalk.dim("    - Expected vs actual behavior"));
    output(chalk.dim("    - Model and provider in use (/status for details)"));
    output("");

    return true;
  },
};
