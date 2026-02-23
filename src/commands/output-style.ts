/**
 * /output-style command — change response style.
 */

import chalk from "chalk";
import { OUTPUT_STYLES, type OutputStyleName, getStylePrompt } from "../core/output-style.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";

export const outputStyleCommand: SlashCommand = {
  name: "output-style",
  description: "Change response style (concise/detailed/markdown/plain)",
  category: "model",
  aliases: ["style"],
  completions: ["concise", "detailed", "markdown", "plain"],
  async execute(args: string, _ctx: CommandContext): Promise<boolean> {
    const style = args.trim().toLowerCase();

    if (!style) {
      console.log(chalk.dim("\nAvailable output styles:"));
      for (const [name, desc] of Object.entries(OUTPUT_STYLES)) {
        console.log(`  ${chalk.cyan(name)}  ${chalk.dim(desc)}`);
      }
      console.log(chalk.dim("\nUsage: /output-style <style>"));
      console.log();
      return true;
    }

    if (!(style in OUTPUT_STYLES)) {
      console.log(chalk.yellow(`Unknown style: "${style}"`));
      console.log(chalk.dim(`Available: ${Object.keys(OUTPUT_STYLES).join(", ")}`));
      return true;
    }

    // Store the style preference — it will be injected into the system prompt
    process.env.CLAUDE_CODE_OUTPUT_STYLE = style;
    console.log(chalk.dim(`Output style set to: ${style}`));
    return true;
  },
};
