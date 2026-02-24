/**
 * CLI Tool Plugin Factory — creates a plugin for a single CLI tool.
 *
 * Each CLI tool plugin registers a prompt segment that:
 * 1. Checks if the tool is installed (via `which`)
 * 2. If installed, injects its description, examples, and notes into the system prompt
 *
 * To add a new CLI tool plugin:
 * 1. Create `src/plugins/cli-<command>.ts`
 * 2. Call createCliToolPlugin({ command, description, examples, notes? })
 * 3. Export the result
 * 4. Register it in src/index.tsx via pluginManager.registerBuiltin(plugin, enabled)
 */

import type { Plugin } from "../core/plugins/types.js";

export interface CliToolDef {
  /** The CLI command name (e.g. "rg", "fd", "jq") */
  command: string;
  /** One-line description of the tool */
  description: string;
  /** Concrete usage examples (one per line, with inline comments) */
  examples: string[];
  /** Optional usage notes / guidance */
  notes?: string;
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    execFile("which", [command], (error) => resolve(!error));
  });
}

function formatToolPrompt(tool: CliToolDef): string {
  const lines: string[] = [
    `## ${tool.command}`,
    tool.description,
    "",
    "Examples:",
    "```",
    ...tool.examples,
    "```",
  ];
  if (tool.notes) {
    lines.push("", tool.notes);
  }
  return lines.join("\n");
}

/**
 * Create a Plugin for a single CLI tool.
 * The plugin registers a dynamic prompt segment that only emits content
 * if the tool is detected on the system.
 */
export function createCliToolPlugin(def: CliToolDef): Plugin {
  return {
    descriptor: {
      name: `cli-${def.command}`,
      version: "1.0.0",
      description: `CLI tool: ${def.command} — ${def.description}`,
    },
    init(ctx) {
      ctx.registerPromptSegment({
        id: `cli-${def.command}`,
        position: "dynamic",
        priority: 15, // after environment (10), before claude-md (20)
        content: async () => {
          const installed = await isCommandAvailable(def.command);
          return installed ? formatToolPrompt(def) : "";
        },
      });
    },
  };
}
