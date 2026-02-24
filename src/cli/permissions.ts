/**
 * Permission Prompts — pipe mode and Ink mode permission prompt factories.
 */

import * as readline from "readline";
import chalk from "chalk";
import type {
  PermissionRequest,
  PermissionResult,
  UserQuestion,
} from "../tools/tool-registry.js";
import type { AppAction } from "../ui/state.js";
import { buildPermissionPattern, saveProjectPermission } from "../core/permission-modes.js";

/**
 * Format a human-readable params string from tool input for the permission prompt.
 */
function formatPermissionParams(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;

  switch (toolName) {
    case "Bash": {
      const cmd = obj.command;
      if (typeof cmd === "string") {
        return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
      }
      return undefined;
    }
    case "Write":
    case "Edit":
    case "Read":
      if (typeof obj.file_path === "string") return obj.file_path;
      return undefined;
    case "WebFetch":
    case "WebSearch":
      if (typeof obj.url === "string") return obj.url;
      if (typeof obj.query === "string") return obj.query;
      return undefined;
    case "Glob":
      if (typeof obj.pattern === "string") return obj.pattern;
      return undefined;
    case "Grep":
      if (typeof obj.pattern === "string") return obj.pattern;
      return undefined;
    default: {
      // Show first string value from input
      for (const val of Object.values(obj)) {
        if (typeof val === "string" && val.length > 0) {
          return val.length > 80 ? val.slice(0, 77) + "..." : val;
        }
      }
      return undefined;
    }
  }
}

/**
 * Creates a permission prompt for pipe/one-shot mode (uses temporary readline).
 */
export function createPipePermissionPrompt(cwd?: string): (
  request: PermissionRequest
) => Promise<PermissionResult> {
  const approvedTools = new Set<string>();

  return (request: PermissionRequest): Promise<PermissionResult> => {
    if (approvedTools.has(request.toolName)) {
      return Promise.resolve("allow");
    }

    return new Promise((resolve) => {
      const params = formatPermissionParams(request.toolName, request.input);
      const toolLabel = params
        ? `${request.toolName}: ${params}`
        : request.toolName;
      const promptText =
        chalk.dim(`  Allow ${toolLabel}? `) +
        chalk.bold("[y]es / [n]o / allow [t]ool / [a]llow all: ");

      process.stdout.write(promptText);
      const tempRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
      });
      tempRl.once("line", (answer) => {
        tempRl.close();
        const a = answer.trim().toLowerCase();
        switch (a) {
          case "y": case "yes": resolve("allow"); break;
          case "t": case "tool":
            approvedTools.add(request.toolName);
            if (cwd) {
              const pattern = buildPermissionPattern(request.toolName, request.input);
              saveProjectPermission(cwd, pattern).catch(() => {});
            }
            resolve("allow");
            break;
          case "a": case "allow": case "allow all": resolve("allow_all"); break;
          case "n": case "no": resolve("deny"); break;
          default: resolve("deny"); break;
        }
      });
      tempRl.once("close", () => resolve("deny"));
    });
  };
}

/**
 * Creates a permission prompt for Ink interactive mode.
 * Dispatches REQUEST_PERMISSION into App state; the PermissionPrompt
 * component handles keypress capture via Ink's useInput hook.
 */
export function createInkPermissionPrompt(
  getDispatch: () => (action: AppAction) => void,
  cwd?: string,
): (request: PermissionRequest) => Promise<PermissionResult> {
  const approvedTools = new Set<string>();

  return (request: PermissionRequest): Promise<PermissionResult> => {
    if (approvedTools.has(request.toolName)) {
      return Promise.resolve("allow");
    }

    return new Promise((resolve) => {
      const params = formatPermissionParams(request.toolName, request.input);
      getDispatch()({
        type: "REQUEST_PERMISSION",
        permission: {
          toolName: request.toolName,
          params,
          resolve: (key: string) => {
            switch (key) {
              case "y": resolve("allow"); break;
              case "t":
                approvedTools.add(request.toolName);
                if (cwd) {
                  const pattern = buildPermissionPattern(request.toolName, request.input);
                  saveProjectPermission(cwd, pattern).catch(() => {});
                }
                resolve("allow");
                break;
              case "a": resolve("allow_all"); break;
              case "n": resolve("deny"); break;
              default: resolve("deny"); break;
            }
          },
        },
      });
    });
  };
}

/**
 * Creates a user input prompt for Ink interactive mode.
 * Dispatches ASK_USER_QUESTION into App state; the QuestionPrompt
 * component handles user interaction.
 */
export function createInkUserInputPrompt(
  getDispatch: () => (action: AppAction) => void,
): (questions: UserQuestion[]) => Promise<Record<string, string>> {
  return (questions: UserQuestion[]): Promise<Record<string, string>> => {
    return new Promise((resolve) => {
      getDispatch()({
        type: "ASK_USER_QUESTION",
        question: {
          questions,
          resolve,
        },
      });
    });
  };
}

/**
 * Creates a user input prompt for pipe/one-shot mode.
 * Auto-selects the first option for each question.
 */
export function createPipeUserInputPrompt(): (
  questions: UserQuestion[]
) => Promise<Record<string, string>> {
  return (questions: UserQuestion[]): Promise<Record<string, string>> => {
    const answers: Record<string, string> = {};
    for (const q of questions) {
      answers[q.question] = q.options[0]?.label ?? "";
    }
    return Promise.resolve(answers);
  };
}
