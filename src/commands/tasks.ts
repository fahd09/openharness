/**
 * /tasks command — list running/completed background tasks.
 */

import chalk from "chalk";
import { listAllBackgroundTasks } from "../tools/background-task-registry.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

function formatElapsed(startedAt: string): string {
  const elapsed = Date.now() - new Date(startedAt).getTime();
  if (elapsed < 1000) return "<1s";
  if (elapsed < 60000) return `${Math.round(elapsed / 1000)}s`;
  return `${Math.round(elapsed / 60000)}m`;
}

export const tasksCommand: SlashCommand = {
  name: "tasks",
  description: "Show background tasks (shells & agents)",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const bgTasks = listAllBackgroundTasks();

    if (bgTasks.length === 0) {
      output(chalk.dim("No background tasks running."));
      return true;
    }

    output(chalk.bold("\n  Background Tasks"));
    output(chalk.dim("  " + "─".repeat(50)));

    for (const task of bgTasks) {
      if (task.kind === "shell") {
        const s = task.entry;
        const statusIcon = s.finished
          ? (s.exitCode === 0 ? chalk.green("✓") : chalk.red("✗"))
          : chalk.yellow("⟳");
        const elapsed = formatElapsed(s.startedAt);
        const preview = s.command.length > 40
          ? s.command.slice(0, 37) + "..."
          : s.command;
        output(`  ${statusIcon} ${chalk.dim(`#${s.id}`)} ${chalk.cyan("shell")} ${preview} ${chalk.dim(elapsed)}`);
        if (s.finished && s.exitCode !== 0) {
          output(chalk.dim(`    exit code: ${s.exitCode}`));
        }
      } else {
        const a = task.entry;
        const statusIcon = a.finished
          ? (a.error ? chalk.red("✗") : chalk.green("✓"))
          : chalk.yellow("⟳");
        const elapsed = formatElapsed(a.startedAt);
        const desc = a.description.length > 40
          ? a.description.slice(0, 37) + "..."
          : a.description;
        output(`  ${statusIcon} ${chalk.dim(`#${a.id}`)} ${chalk.magenta("agent")} ${desc} ${chalk.dim(elapsed)}`);
        if (a.error) {
          output(chalk.dim(`    error: ${a.error}`));
        }
      }
    }

    const running = bgTasks.filter((t) =>
      t.kind === "shell" ? !t.entry.finished : !t.entry.finished
    ).length;
    output(chalk.dim("  " + "─".repeat(50)));
    output(chalk.dim(`  ${bgTasks.length} total, ${running} running`));
    output("");

    return true;
  },
};
