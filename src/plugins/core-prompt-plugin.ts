/**
 * Core Prompt Plugin — registers all system prompt segments.
 *
 * Replaces the hardcoded buildSystemPrompt logic with plugin-registered
 * prompt segments. Each section (identity, system rules, tool instructions,
 * guidelines, environment, claude-md) becomes a registered segment.
 */

import type { Plugin } from "../core/plugins/types.js";
import {
  identitySection,
  systemSection,
  toolInstructions,
  taskGuidelines,
  codingGuidelines,
  environmentSection,
} from "../prompt/system-prompt.js";
import { loadContextFiles } from "../prompt/context-file.js";
import { getStylePrompt } from "../core/output-style.js";

export const corePromptPlugin: Plugin = {
  descriptor: {
    name: "core-prompt",
    version: "1.0.0",
    description: "Core system prompt segments (identity, rules, tools, guidelines, environment)",
  },

  init(ctx) {
    // ── Static segments (cached, stable across all sessions) ──────

    ctx.registerPromptSegment({
      id: "identity",
      position: "static",
      priority: 10,
      content: () => identitySection(),
    });

    ctx.registerPromptSegment({
      id: "system-rules",
      position: "static",
      priority: 20,
      content: () => systemSection(),
    });

    ctx.registerPromptSegment({
      id: "tool-instructions",
      position: "static",
      priority: 30,
      content: ({ toolNames }) => toolInstructions(toolNames),
    });

    ctx.registerPromptSegment({
      id: "task-guidelines",
      position: "static",
      priority: 40,
      content: () => taskGuidelines(),
    });

    ctx.registerPromptSegment({
      id: "coding-guidelines",
      position: "static",
      priority: 50,
      content: () => codingGuidelines(),
    });

    // ── Dynamic segments (cached, stable within a session) ────────

    ctx.registerPromptSegment({
      id: "environment",
      position: "dynamic",
      priority: 10,
      content: ({ cwd }) => environmentSection(cwd),
    });

    ctx.registerPromptSegment({
      id: "context-file",
      position: "dynamic",
      priority: 20,
      content: async ({ cwd, provider }) => {
        const contextMd = await loadContextFiles(cwd, provider);
        return contextMd ?? "";
      },
    });

    // ── Volatile segments (uncached, changes frequently) ──────────

    ctx.registerPromptSegment({
      id: "output-style",
      position: "volatile",
      priority: 50,
      content: () => {
        const stylePrompt = getStylePrompt();
        return stylePrompt ? `# Output Style\n${stylePrompt}` : "";
      },
    });
  },
};
