/**
 * TaskList — renders tasks from TodoWrite / TaskCreate / TaskUpdate
 * with status icons and progress indicators.
 *
 *   ✔ Create prompt loader module
 *   ◼ Updating agent-prompts.ts…
 *   ◻ Update context.ts, bash-analyzer.ts, hook-prompt.ts
 *   ◻ Verify implementation
 */

import React from "react";
import { Text, Box } from "ink";
import chalk from "chalk";
import type { TaskItem } from "../state.js";
import { icons, colors } from "../theme.js";

interface Props {
  tasks: TaskItem[];
  visible: boolean;
}

const MAX_VISIBLE = 10;
const COMPLETED_HIDE_AFTER_MS = 30_000;

export function TaskList({ tasks, visible }: Props): React.ReactElement | null {
  if (!visible || tasks.length === 0) return null;

  const now = Date.now();

  // Filter: hide completed tasks older than 30s
  const visibleTasks = tasks.filter((t) => {
    if (t.status === "completed" && t.completedAt) {
      return now - t.completedAt < COMPLETED_HIDE_AFTER_MS;
    }
    return true;
  });

  if (visibleTasks.length === 0) return null;

  // Count overflow
  const inProgress = visibleTasks.filter((t) => t.status === "in_progress").length;
  const pending = visibleTasks.filter((t) => t.status === "pending").length;
  const showTasks = visibleTasks.slice(0, MAX_VISIBLE);
  const overflow = visibleTasks.length - showTasks.length;

  return (
    <Box flexDirection="column" marginTop={1}>
      {showTasks.map((task) => (
        <Text key={task.id}>
          {"  "}
          {formatTaskLine(task)}
        </Text>
      ))}
      {overflow > 0 && (
        <Text>
          {"  "}
          {chalk.dim(`... +${inProgress > 0 ? `${inProgress} in progress, ` : ""}${pending} pending`)}
        </Text>
      )}
    </Box>
  );
}

function formatTaskLine(task: TaskItem): string {
  switch (task.status) {
    case "completed":
      return chalk.green(icons.tick) + " " + chalk.dim.strikethrough(task.subject);

    case "in_progress": {
      const label = task.activeForm ?? task.subject;
      return colors.brand(icons.squareSmallFilled) + " " + chalk.bold(label) + chalk.dim("\u2026");
    }

    case "pending": {
      let line = chalk.dim(icons.squareSmall) + " " + task.subject;
      if (task.blockedBy && task.blockedBy.length > 0) {
        line += chalk.dim(` ${icons.pointer} blocked by #${task.blockedBy.join(", #")}`);
      }
      return line;
    }

    default:
      return task.subject;
  }
}
