/**
 * Skills Plugin — loads skills and registers the /skills command + prompt segment.
 */

import type { Plugin } from "../core/plugins/types.js";
import { skillsCommand } from "../commands/skills-cmd.js";
import { loadSkills, listSkills } from "../core/skills.js";

export const skillsPlugin: Plugin = {
  descriptor: {
    name: "skills",
    version: "1.0.0",
    description: "Skill system (SKILL.md loading, /skills command, skill list in prompt)",
  },

  async init(ctx) {
    await loadSkills(ctx.cwd);

    ctx.registerCommand(skillsCommand);

    ctx.registerPromptSegment({
      id: "skills-list",
      position: "dynamic",
      priority: 40,
      content: () => {
        const skills = listSkills().filter((s) => !s.disableModelInvocation);
        if (skills.length === 0) return "";
        const skillLines = skills.map((s) => `- ${s.command}: ${s.description}`);
        return `# Available Skills\n${skillLines.join("\n")}`;
      },
    });
  },
};
