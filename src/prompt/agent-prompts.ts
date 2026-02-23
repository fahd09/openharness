/**
 * Per-agent-type system prompts.
 *
 * Each built-in agent type has a dedicated system prompt tuned for its role,
 * matching the original Claude Code's agent-specific instructions.
 *
 * Prompts are loaded from src/prompts/ markdown files with user/project
 * override support via the prompt-loader module.
 */

import { loadPrompt } from "../core/prompt-loader.js";

// ── Explore Agent ────────────────────────────────────────────────────

function explorePrompt(toolNames: string[]): string {
  const tools: string[] = [];
  if (toolNames.includes("Glob")) tools.push("- Use Glob for broad file pattern matching");
  if (toolNames.includes("Grep")) tools.push("- Use Grep for searching file contents with regex");
  if (toolNames.includes("Read")) tools.push("- Use Read when you know the specific file path you need to read");
  if (toolNames.includes("Bash")) {
    tools.push("- Use Bash for file operations like copying, moving, or listing directory contents");
    tools.push("");
    tools.push("CLI tools available via Bash (use these when they are better than built-in tools):");
    tools.push('- `rg` (ripgrep): Fast text search. Example: `rg "TODO" --type ts` to find TODOs in TypeScript files');
    tools.push('- `fd`: Fast file finder. Example: `fd -e ts src/` to find all .ts files under src/');
    tools.push('- `ast-grep`: Syntax-aware code search. Example: `ast-grep --lang ts --pattern "async function $NAME($$$ARGS)"` to find async functions');
    tools.push("- `jq`: JSON processing. Example: `jq '.dependencies' package.json` to extract dependencies");
    tools.push("");
    tools.push("When to use ast-grep vs rg:");
    tools.push("- ast-grep: for STRUCTURAL code queries (find async functions, class methods, imports). Understands syntax.");
    tools.push("- rg: for PLAIN TEXT searches (find TODOs, string literals, comments). Faster for simple patterns.");
  }

  const base = loadPrompt("agent-explore");
  return base.replace("{{TOOL_GUIDELINES}}", tools.join("\n"));
}

// ── Prompt Registry ──────────────────────────────────────────────────

/**
 * Get the system prompt for a given agent type.
 * Falls back to the generic agent identity if no specific prompt exists.
 */
export function getAgentPrompt(agentType: string, toolNames: string[]): string {
  switch (agentType) {
    case "Explore":
      return explorePrompt(toolNames);
    case "general-purpose":
      return loadPrompt("agent-general");
    case "Bash":
      return loadPrompt("agent-bash");
    case "security-review":
      return loadPrompt("agent-security");
    default:
      return loadPrompt("agent-default");
  }
}
