/**
 * /diff command — show file changes made during this session.
 */

import chalk from "chalk";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const diffCommand: SlashCommand = {
  name: "diff",
  description: "Show file changes made this session",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const changes = ctx.fileTracker.getChanges();

    if (changes.length === 0) {
      console.log(chalk.dim("No file changes recorded this session."));
      return true;
    }

    const summary = ctx.fileTracker.getSummary();
    console.log(chalk.bold("\n  File Changes"));
    console.log(chalk.dim("  " + "─".repeat(50)));

    // Group by file
    const byFile = new Map<string, typeof changes>();
    for (const change of changes) {
      const existing = byFile.get(change.path) ?? [];
      existing.push(change);
      byFile.set(change.path, existing);
    }

    for (const [path, fileChanges] of byFile) {
      const ops = fileChanges.map((c) => c.operation);
      const opLabel = ops.includes("create")
        ? chalk.green("created")
        : chalk.yellow("modified");
      const totalAdded = fileChanges.reduce((s, c) => s + c.linesAdded, 0);
      const totalRemoved = fileChanges.reduce((s, c) => s + c.linesRemoved, 0);

      console.log(
        `  ${opLabel} ${chalk.dim(path)}` +
          (totalAdded || totalRemoved
            ? ` ${chalk.green(`+${totalAdded}`)} ${chalk.red(`-${totalRemoved}`)}`
            : "")
      );
    }

    console.log(chalk.dim("  " + "─".repeat(50)));
    console.log(
      chalk.dim(
        `  ${summary.filesChanged} file(s), ` +
          `${chalk.green(`+${summary.totalAdded}`)} ${chalk.red(`-${summary.totalRemoved}`)}`
      )
    );
    console.log();

    return true;
  },
};
