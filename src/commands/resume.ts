/**
 * /resume command — resume a previous session interactively.
 */

import chalk from "chalk";
import { listSessions, loadSession } from "../core/session.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const resumeCommand: SlashCommand = {
  name: "resume",
  description: "Resume a previous session",
  category: "session",
  aliases: ["r"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    // If session ID provided directly
    if (args) {
      const session = await loadSession(args.trim(), ctx.cwd);
      if (!session) {
        console.log(chalk.yellow(`Session "${args.trim()}" not found.`));
        return true;
      }

      ctx.messages.length = 0;
      for (const msg of session.messages) {
        ctx.messages.push(msg);
      }
      console.log(
        chalk.dim(
          `Resumed session ${session.metadata.id} (${session.messages.length} messages): ${session.metadata.title}`
        )
      );
      return true;
    }

    // Interactive picker
    const sessions = await listSessions(ctx.cwd);
    if (sessions.length === 0) {
      console.log(chalk.dim("No saved sessions."));
      return true;
    }

    console.log(chalk.dim("\nAvailable sessions:"));
    const shown = sessions.slice(0, 10);
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      console.log(
        chalk.dim(
          `  ${chalk.cyan(`[${i + 1}]`)} ${s.id}  ${s.updatedAt.slice(0, 16)}  ${s.messageCount} msgs  ${s.title}`
        )
      );
    }
    console.log();

    // Use readline if available, otherwise prompt via runPrompt
    if (ctx.rl) {
      return new Promise<boolean>((resolve) => {
        ctx.rl!.question(chalk.dim("  Enter number or session ID: "), async (answer) => {
          await resumeByAnswer(answer, shown, ctx);
          resolve(true);
        });
      });
    }

    // Ink mode: show the prompt and let the user type the session ID next
    console.log(chalk.dim("  Enter /resume <number or session ID> to resume."));
    return true;
  },
};

async function resumeByAnswer(
  answer: string,
  shown: Awaited<ReturnType<typeof listSessions>>,
  ctx: CommandContext,
): Promise<void> {
  const trimmed = answer.trim();
  if (!trimmed) return;

  // Try as number index
  const idx = parseInt(trimmed, 10);
  let sessionId: string;
  if (!isNaN(idx) && idx >= 1 && idx <= shown.length) {
    sessionId = shown[idx - 1].id;
  } else {
    sessionId = trimmed;
  }

  const session = await loadSession(sessionId, ctx.cwd);
  if (!session) {
    console.log(chalk.yellow(`Session "${sessionId}" not found.`));
    return;
  }

  ctx.messages.length = 0;
  for (const msg of session.messages) {
    ctx.messages.push(msg);
  }
  console.log(
    chalk.dim(
      `Resumed session ${session.metadata.id} (${session.messages.length} messages)`
    )
  );
}
