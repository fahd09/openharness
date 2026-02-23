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
  async execute(args: string, _ctx: CommandContext): Promise<boolean> {
    console.log(chalk.bold("\n  Feedback & Bug Reports"));
    console.log(chalk.dim("  " + "─".repeat(40)));
    console.log();

    if (args) {
      console.log(chalk.dim("  Thank you for your feedback!"));
      console.log(chalk.dim(`  "${args}"`));
      console.log();
      console.log(chalk.dim("  To file a formal report, please visit:"));
    } else {
      console.log(chalk.dim("  To report issues or provide feedback:"));
    }

    console.log(chalk.cyan("  https://github.com/anthropics/claude-code/issues"));
    console.log();
    console.log(chalk.dim("  When reporting bugs, please include:"));
    console.log(chalk.dim("    - Steps to reproduce"));
    console.log(chalk.dim("    - Expected vs actual behavior"));
    console.log(chalk.dim("    - Model and provider in use (/status for details)"));
    console.log();

    return true;
  },
};
