/**
 * /export command — export conversation to file or clipboard.
 */

import chalk from "chalk";
import { writeFile } from "fs/promises";
import { join } from "path";
import { execSync } from "child_process";
import { platform } from "os";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import type { ConversationMessage } from "../core/types.js";

function messagesToMarkdown(messages: ConversationMessage[]): string {
  const lines: string[] = ["# Conversation Export\n"];

  for (const msg of messages) {
    if (msg.type === "user") {
      lines.push("## User\n");
      if (typeof msg.content === "string") {
        lines.push(msg.content + "\n");
      } else {
        for (const block of msg.content) {
          if (typeof block.content === "string") {
            if ("type" in block && block.type === "tool_result") {
              lines.push("```\n" + block.content + "\n```\n");
            } else {
              lines.push(block.content + "\n");
            }
          }
        }
      }
    } else {
      lines.push("## Assistant\n");
      for (const block of msg.content) {
        if (block.type === "text") {
          lines.push(block.text + "\n");
        } else if (block.type === "tool_use") {
          lines.push(`**Tool: ${block.name}**\n`);
          lines.push("```json\n" + JSON.stringify(block.input, null, 2) + "\n```\n");
        }
      }
    }
  }

  return lines.join("\n");
}

export const exportCommand: SlashCommand = {
  name: "export",
  description: "Export conversation (markdown, json, clipboard)",
  category: "session",
  completions: ["markdown", "json", "clipboard"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const format = args.trim().toLowerCase() || "markdown";

    if (ctx.messages.length === 0) {
      output(chalk.dim("No messages to export."));
      return true;
    }

    if (format === "clipboard") {
      const md = messagesToMarkdown(ctx.messages);
      try {
        const cmd = platform() === "darwin" ? "pbcopy" : "xclip -selection clipboard";
        execSync(cmd, { input: md });
        output(chalk.green("Conversation copied to clipboard."));
      } catch {
        output(chalk.red("Failed to copy to clipboard. Is pbcopy/xclip available?"));
      }
      return true;
    }

    if (format === "json") {
      const data = {
        sessionId: ctx.sessionId,
        model: ctx.model,
        exportedAt: new Date().toISOString(),
        messageCount: ctx.messages.length,
        messages: ctx.messages,
      };
      const filePath = join(ctx.cwd, `session-${ctx.sessionId}.json`);
      await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
      output(chalk.green(`Exported JSON to ${filePath}`));
      return true;
    }

    // Default: markdown
    const md = messagesToMarkdown(ctx.messages);
    const filePath = join(ctx.cwd, `session-${ctx.sessionId}.md`);
    await writeFile(filePath, md, "utf-8");
    output(chalk.green(`Exported markdown to ${filePath}`));
    return true;
  },
};
