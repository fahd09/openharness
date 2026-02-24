/**
 * /rewind command — restore conversation to a previous turn.
 */

import chalk from "chalk";
import { saveSession } from "../core/session.js";
import { getFileHistory } from "../core/file-history.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import type { ListItem } from "../ui/components/list-selector.js";

function getUserMessagePreview(content: unknown): string {
  if (typeof content === "string") {
    return content.length > 60 ? content.slice(0, 57) + "..." : content;
  }
  return "(tool results)";
}

export const rewindCommand: SlashCommand = {
  name: "rewind",
  description: "Rewind conversation to a previous turn",
  category: "session",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;

    // Build checkpoints from user messages
    const checkpoints: Array<{ turnNumber: number; messageIndex: number; preview: string; timestamp?: string }> = [];
    let turnNumber = 0;
    for (let i = 0; i < ctx.messages.length; i++) {
      if (ctx.messages[i].type === "user") {
        turnNumber++;
        checkpoints.push({
          turnNumber,
          messageIndex: i,
          preview: getUserMessagePreview(ctx.messages[i].content),
          timestamp: ctx.messages[i].timestamp,
        });
      }
    }

    if (checkpoints.length <= 1) {
      output(chalk.dim("Not enough turns to rewind."));
      return true;
    }

    let targetIdx: number;

    // Direct rewind by turn number
    const turnArg = parseInt(args.trim(), 10);
    if (!isNaN(turnArg) && turnArg > 0) {
      const cp = checkpoints.find((c) => c.turnNumber === turnArg);
      if (!cp) {
        output(chalk.red(`Turn ${turnArg} not found. Available: 1-${checkpoints[checkpoints.length - 1].turnNumber}`));
        return true;
      }
      targetIdx = cp.messageIndex;
    } else if (ctx.dispatch) {
      // Interactive picker
      const items: ListItem[] = checkpoints.map((cp) => ({
        id: String(cp.messageIndex),
        label: `Turn ${cp.turnNumber}`,
        description: cp.preview,
      }));

      const selected = await new Promise<string | null>((resolve) => {
        ctx.dispatch!({
          type: "LIST_SELECT_START",
          items,
          header: "Select turn to rewind to",
          resolve,
        });
      });

      if (!selected) {
        output(chalk.dim("Rewind cancelled."));
        return true;
      }
      targetIdx = parseInt(selected, 10);
    } else {
      // No dispatch, show list
      output(chalk.bold("\n  Available turns:"));
      for (const cp of checkpoints) {
        output(`  ${chalk.dim(`[${cp.turnNumber}]`)} ${cp.preview}`);
      }
      output(chalk.dim("\nUsage: /rewind <turn-number>"));
      return true;
    }

    // Find affected files (snapshots after the rewind point)
    const rewindTimestamp = ctx.messages[targetIdx]?.timestamp;
    const allSnapshots = getFileHistory().getAll();
    const affectedFiles = new Set<string>();
    if (rewindTimestamp) {
      for (const snap of allSnapshots) {
        if (snap.timestamp > rewindTimestamp) {
          affectedFiles.add(snap.path);
        }
      }
    }

    // Truncate messages to the selected checkpoint (keep the user message at targetIdx)
    // Find the end of that turn: next user message or end of array
    let endIdx = ctx.messages.length;
    for (let i = targetIdx + 1; i < ctx.messages.length; i++) {
      if (ctx.messages[i].type === "user") {
        endIdx = i;
        break;
      }
    }
    ctx.messages.length = endIdx;

    // Save truncated session
    await saveSession(ctx.sessionId, ctx.messages, ctx.model, ctx.cwd);

    // Show divider
    const turnNum = checkpoints.find((c) => c.messageIndex === targetIdx)?.turnNumber ?? "?";
    if (ctx.dispatch) {
      ctx.dispatch({
        type: "FREEZE_BLOCK",
        block: {
          id: `rewind-${Date.now()}`,
          text: chalk.dim(`\n${"─".repeat(50)}\n`) +
            chalk.yellow(`  Rewound to turn ${turnNum} (${ctx.messages.length} messages)`) +
            (affectedFiles.size > 0
              ? chalk.dim(`\n  ${affectedFiles.size} file(s) may have been modified since this point`)
              : "") +
            chalk.dim(`\n${"─".repeat(50)}`),
          type: "system",
        },
      });
    } else {
      output(chalk.yellow(`Rewound to turn ${turnNum} (${ctx.messages.length} messages)`));
      if (affectedFiles.size > 0) {
        output(chalk.dim(`${affectedFiles.size} file(s) may have been modified since this point:`));
        for (const f of affectedFiles) {
          output(chalk.dim(`  ${f}`));
        }
      }
    }

    return true;
  },
};
