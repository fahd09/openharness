/**
 * /resume command — resume a previous session interactively.
 */

import chalk from "chalk";
import { listSessions, loadSession } from "../core/session.js";
import { renderMarkdown } from "../core/markdown.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import type { ConversationMessage } from "../core/types.js";
import { icons } from "../ui/theme.js";

export const resumeCommand: SlashCommand = {
  name: "resume",
  description: "Resume a previous session",
  category: "session",
  aliases: ["r", "sessions", "history"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;

    // If session ID provided directly
    if (args) {
      const session = await loadSession(args.trim(), ctx.cwd);
      if (!session) {
        output(chalk.yellow(`Session "${args.trim()}" not found.`));
        return true;
      }

      loadSessionIntoContext(session.messages, session.metadata.id, ctx);
      return true;
    }

    // Interactive picker
    const sessions = await listSessions(ctx.cwd);
    if (sessions.length === 0) {
      output(chalk.dim("No saved sessions."));
      return true;
    }

    // Ink mode: use interactive session selector
    if (ctx.dispatch) {
      const selectedId = await new Promise<string | null>((resolve) => {
        ctx.dispatch!({
          type: "SESSION_SELECT_START",
          sessions,
          resolve,
        });
      });

      if (!selectedId) {
        output(chalk.dim("Session selection cancelled."));
        return true;
      }

      const session = await loadSession(selectedId, ctx.cwd);
      if (!session) {
        output(chalk.yellow(`Session "${selectedId}" not found.`));
        return true;
      }

      loadSessionIntoContext(session.messages, session.metadata.id, ctx);
      return true;
    }

    // Readline fallback
    output(chalk.dim("\nAvailable sessions:"));
    const shown = sessions.slice(0, 10);
    for (let i = 0; i < shown.length; i++) {
      const s = shown[i];
      output(
        chalk.dim(
          `  ${chalk.cyan(`[${i + 1}]`)} ${s.id}  ${s.updatedAt.slice(0, 16)}  ${s.messageCount} msgs  ${s.title}`
        )
      );
    }
    output("");

    if (ctx.rl) {
      return new Promise<boolean>((resolve) => {
        ctx.rl!.question(chalk.dim("  Enter number or session ID: "), async (answer) => {
          await resumeByAnswer(answer, shown, ctx);
          resolve(true);
        });
      });
    }

    output(chalk.dim("  Enter /resume <number or session ID> to resume."));
    return true;
  },
};

/**
 * Load session messages into the conversation and render them as UI blocks.
 */
function loadSessionIntoContext(
  messages: ConversationMessage[],
  sessionId: string,
  ctx: CommandContext,
): void {
  ctx.messages.length = 0;
  for (const msg of messages) {
    ctx.messages.push(msg);
  }

  // Render conversation history as visible blocks in Ink mode
  if (ctx.dispatch) {
    for (const msg of messages) {
      if (msg.type === "user" && typeof msg.content === "string") {
        ctx.dispatch({
          type: "FREEZE_BLOCK",
          block: {
            id: `resumed-user-${msg.uuid}`,
            text: `\n${chalk.bgWhite.black(` ${icons.pointer} ${msg.content} `)}`,
            type: "user",
          },
        });
      } else if (msg.type === "assistant") {
        // Extract text content from assistant message
        const textParts: string[] = [];
        for (const b of msg.content) {
          if (b.type === "text") {
            textParts.push(b.text);
          }
        }
        if (textParts.length > 0) {
          ctx.dispatch({
            type: "FREEZE_BLOCK",
            block: {
              id: `resumed-asst-${msg.uuid}`,
              text: renderMarkdown(textParts.join("\n")),
              type: "assistant",
            },
          });
        }
      }
    }

    ctx.dispatch({
      type: "FREEZE_BLOCK",
      block: {
        id: `resumed-divider-${sessionId}`,
        text: chalk.dim(`\n${"─".repeat(40)}\nResumed session ${sessionId} (${messages.length} messages)\n`),
        type: "system",
      },
    });
  } else {
    const output = ctx.output ?? console.log;
    output(
      chalk.dim(
        `Resumed session ${sessionId} (${messages.length} messages)`
      )
    );
  }
}

async function resumeByAnswer(
  answer: string,
  shown: Awaited<ReturnType<typeof listSessions>>,
  ctx: CommandContext,
): Promise<void> {
  const output = ctx.output ?? console.log;
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
    output(chalk.yellow(`Session "${sessionId}" not found.`));
    return;
  }

  loadSessionIntoContext(session.messages, session.metadata.id, ctx);
}
