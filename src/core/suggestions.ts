/**
 * Prompt Suggestions — context-aware suggestions based on project type.
 *
 * Detects project type from config files and suggests relevant prompts.
 * Displayed in the welcome message for new sessions.
 */

import { access, constants } from "fs/promises";
import { join } from "path";

interface Suggestion {
  text: string;
  condition: string; // File that must exist
}

const SUGGESTIONS: Suggestion[] = [
  { text: "Explain the project structure", condition: "package.json" },
  { text: "Explain the project structure", condition: "pyproject.toml" },
  { text: "Run the tests and fix any failures", condition: "package.json" },
  { text: "Run the tests and fix any failures", condition: "pyproject.toml" },
  { text: "Review recent changes for bugs", condition: ".git" },
  { text: "Create a git commit with recent changes", condition: ".git" },
  { text: "Find and fix TypeScript errors", condition: "tsconfig.json" },
  { text: "Add missing test coverage", condition: "jest.config.js" },
  { text: "Add missing test coverage", condition: "vitest.config.ts" },
  { text: "Review and update dependencies", condition: "package.json" },
  { text: "Generate API documentation", condition: "src" },
  { text: "Set up CI/CD pipeline", condition: ".git" },
];

/**
 * Get context-aware prompt suggestions for the current project.
 * Returns up to 3 unique suggestions.
 */
export async function getSuggestions(cwd: string): Promise<string[]> {
  const suggestions: string[] = [];
  const seen = new Set<string>();

  const checks = await Promise.all(
    SUGGESTIONS.map(async (s) => {
      try {
        await access(join(cwd, s.condition), constants.R_OK);
        return s;
      } catch {
        return null;
      }
    })
  );

  for (const s of checks) {
    if (s && !seen.has(s.text) && suggestions.length < 3) {
      seen.add(s.text);
      suggestions.push(s.text);
    }
  }

  return suggestions;
}
