/**
 * /todos command — display session todo items from TodoWrite tool.
 */

import chalk from "chalk";
import { getTodoList } from "../tools/todo-write.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const todosCommand: SlashCommand = {
  name: "todos",
  description: "Show session todo items",
  category: "info",
  async execute(_args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const todos = getTodoList();

    if (todos.length === 0) {
      output(chalk.dim("No todos. The assistant can create them with TodoWrite."));
      return true;
    }

    output(chalk.bold("\n  Todos"));
    output(chalk.dim("  " + "─".repeat(50)));

    for (const todo of todos) {
      const icon =
        todo.status === "completed" ? chalk.green("✓") :
        todo.status === "in_progress" ? chalk.yellow("→") :
        chalk.dim("○");
      const priority = todo.priority
        ? ` ${chalk.magenta(`[${todo.priority}]`)}`
        : "";
      const content =
        todo.status === "completed"
          ? chalk.strikethrough.dim(todo.content)
          : todo.content;
      output(`  ${icon} #${todo.id}${priority} ${content}`);
    }

    const completed = todos.filter((t) => t.status === "completed").length;
    const total = todos.length;
    output(chalk.dim("  " + "─".repeat(50)));
    output(chalk.dim(`  ${completed}/${total} completed`));
    output("");

    return true;
  },
};
