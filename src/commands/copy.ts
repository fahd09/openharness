/**
 * /copy command — Copy the last code block or a specific numbered block to clipboard.
 *
 * Usage:
 *   /copy       — Copy the last code block from the assistant's response
 *   /copy 2     — Copy the 2nd code block
 *   /copy all   — Copy the full last assistant response
 */

import chalk from "chalk";
import { execFile } from "child_process";
import type { SlashCommand, CommandContext } from "../core/commands.js";

/**
 * Extract code blocks from markdown text.
 * Returns array of { lang, code } objects.
 */
function extractCodeBlocks(text: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    blocks.push({
      lang: match[1] || "",
      code: match[2].trimEnd(),
    });
  }

  return blocks;
}

/**
 * Copy text to clipboard using platform-native commands.
 */
function copyToClipboard(text: string): Promise<boolean> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd: string;
    let args: string[];

    if (platform === "darwin") {
      cmd = "pbcopy";
      args = [];
    } else if (platform === "linux") {
      // Try xclip first, fall back to xsel
      cmd = "xclip";
      args = ["-selection", "clipboard"];
    } else if (platform === "win32") {
      cmd = "clip";
      args = [];
    } else {
      resolve(false);
      return;
    }

    const child = execFile(cmd, args, { timeout: 5000 }, (error) => {
      resolve(!error);
    });

    child.stdin?.write(text);
    child.stdin?.end();
  });
}

/**
 * Get the last assistant message's text content.
 */
function getLastAssistantText(ctx: CommandContext): string | null {
  for (let i = ctx.messages.length - 1; i >= 0; i--) {
    const msg = ctx.messages[i];
    if (msg.type === "assistant" && Array.isArray(msg.content)) {
      const textBlocks = msg.content.filter(
        (b: { type: string }) => b.type === "text"
      );
      if (textBlocks.length > 0) {
        return textBlocks
          .map((b: { type: string; text?: string }) => b.text ?? "")
          .join("\n");
      }
    }
  }
  return null;
}

export const copyCommand: SlashCommand = {
  name: "copy",
  description: "Copy code block to clipboard (/copy [number|all])",
  category: "tools",
  completions: ["all"],
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const assistantText = getLastAssistantText(ctx);
    if (!assistantText) {
      output(chalk.dim("No assistant response to copy from."));
      return true;
    }

    let textToCopy: string;

    if (args.toLowerCase() === "all") {
      textToCopy = assistantText;
    } else {
      const blocks = extractCodeBlocks(assistantText);

      if (blocks.length === 0) {
        // No code blocks — copy the whole response
        textToCopy = assistantText;
        output(chalk.dim("No code blocks found. Copying full response."));
      } else if (args) {
        const idx = parseInt(args, 10);
        if (isNaN(idx) || idx < 1 || idx > blocks.length) {
          output(chalk.dim(`Invalid block number. ${blocks.length} block(s) available.`));
          // List blocks
          for (let i = 0; i < blocks.length; i++) {
            const b = blocks[i];
            const lang = b.lang ? ` (${b.lang})` : "";
            const preview = b.code.split("\n")[0].slice(0, 50);
            output(chalk.dim(`  ${i + 1}. ${preview}...${lang}`));
          }
          return true;
        }
        textToCopy = blocks[idx - 1].code;
      } else {
        // Default: copy the last code block
        textToCopy = blocks[blocks.length - 1].code;
      }
    }

    const success = await copyToClipboard(textToCopy);
    if (success) {
      const lines = textToCopy.split("\n").length;
      output(chalk.green(`Copied ${lines} line(s) to clipboard.`));
    } else {
      output(chalk.yellow("Could not copy to clipboard. Clipboard tool not found."));
      output(chalk.dim("  Install pbcopy (macOS), xclip (Linux), or clip (Windows)."));
    }

    return true;
  },
};
