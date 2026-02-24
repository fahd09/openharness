/**
 * /skills command — list and select skills interactively.
 *
 * Usage:
 *   /skills         — Interactive skill picker (or text list if no dispatch)
 *   /skills <name>  — Run a specific skill directly
 */

import chalk from "chalk";
import {
  listSkills,
  getSkill,
  preprocessSkillContent,
  markSkillInvoked,
  isSkillInvokedOnce,
} from "../core/skills.js";
import type { SlashCommand, CommandContext } from "../core/commands.js";
import type { ListItem } from "../ui/components/list-selector.js";

export const skillsCommand: SlashCommand = {
  name: "skills",
  description: "List and run loaded skills",
  category: "tools",
  async execute(args: string, ctx: CommandContext): Promise<boolean> {
    const output = ctx.output ?? console.log;
    const loaded = listSkills();

    if (loaded.length === 0) {
      output(
        chalk.dim("No skills loaded. Add SKILL.md files to .openharness/skills/")
      );
      return true;
    }

    // Direct skill execution with args
    if (args) {
      const command = args.trim().startsWith("/") ? args.trim() : `/${args.trim()}`;
      const skill = getSkill(command);
      if (!skill) {
        output(chalk.yellow(`Skill not found: ${command}`));
        return true;
      }
      return await executeSkill(skill.command, ctx, output);
    }

    // Interactive selector if dispatch is available
    if (ctx.dispatch) {
      const items: ListItem[] = loaded.map((s) => {
        const invoked = s.once && isSkillInvokedOnce(s.command);
        return {
          id: s.command,
          label: s.command,
          description: s.description,
          badge: invoked ? "used" : undefined,
          disabled: invoked,
        };
      });

      return new Promise<boolean>((resolve) => {
        ctx.dispatch!({
          type: "LIST_SELECT_START",
          items,
          header: "Select a skill to run",
          resolve: async (selectedId) => {
            if (!selectedId) {
              output(chalk.dim("Skill selection cancelled."));
              resolve(true);
              return;
            }

            await executeSkill(selectedId, ctx, output);
            resolve(true);
          },
        });
      });
    }

    // Fallback: text list
    output(chalk.dim("\nLoaded skills:"));
    for (const s of loaded) {
      output(chalk.dim(`  ${s.command}  ${s.description}`));
    }
    output("");
    return true;
  },
};

async function executeSkill(
  command: string,
  ctx: CommandContext,
  output: (text: string) => void,
): Promise<boolean> {
  const skill = getSkill(command);
  if (!skill) {
    output(chalk.yellow(`Skill not found: ${command}`));
    return true;
  }

  if (skill.once && isSkillInvokedOnce(skill.command)) {
    output(chalk.yellow(`Skill ${skill.command} can only be used once per session.`));
    return true;
  }

  const content = await preprocessSkillContent(skill.prompt, "", ctx.cwd);

  let prompt: string;
  if (skill.context === "fork") {
    const agentType = skill.agent || "general-purpose";
    prompt = `Use the Task tool to delegate the following to a "${agentType}" agent:\n\n${content}`;
  } else {
    prompt = content;
  }

  if (skill.once) {
    markSkillInvoked(skill.command);
  }

  await ctx.runPrompt(prompt);
  return true;
}
