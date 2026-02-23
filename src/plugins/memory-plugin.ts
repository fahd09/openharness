/**
 * Memory Plugin — registers the /memory command and memory prompt segment.
 */

import type { Plugin } from "../core/plugins/types.js";
import { memoryCommand } from "../commands/memory.js";
import { loadMemory } from "../core/memory.js";

export const memoryPlugin: Plugin = {
  descriptor: {
    name: "memory",
    version: "1.0.0",
    description: "Persistent memory system (MEMORY.md in system prompt + /memory command)",
  },

  init(ctx) {
    ctx.registerCommand(memoryCommand);

    ctx.registerPromptSegment({
      id: "memory",
      position: "dynamic",
      priority: 30,
      content: async ({ cwd }) => {
        const memory = await loadMemory(cwd);
        if (!memory) return "";
        const memoryLines = memory.split("\n").slice(0, 200);
        return `# Memory\n${memoryLines.join("\n")}`;
      },
    });
  },
};
