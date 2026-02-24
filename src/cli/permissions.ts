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

/**
 * Creates a permission prompt for pipe/one-shot mode (uses temporary readline).
 */
export function createPipePermissionPrompt(): (
  request: PermissionRequest
) => Promise<PermissionResult> {
  const approvedTools = new Set<string>();

  return (request: PermissionRequest): Promise<PermissionResult> => {
    if (approvedTools.has(request.toolName)) {
      return Promise.resolve("allow");
    }

    return new Promise((resolve) => {
      const promptText =
        chalk.dim("  Allow? ") +
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
          case "t": case "tool": approvedTools.add(request.toolName); resolve("allow"); break;
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
): (request: PermissionRequest) => Promise<PermissionResult> {
  const approvedTools = new Set<string>();

  return (request: PermissionRequest): Promise<PermissionResult> => {
    if (approvedTools.has(request.toolName)) {
      return Promise.resolve("allow");
    }

    return new Promise((resolve) => {
      getDispatch()({
        type: "REQUEST_PERMISSION",
        permission: {
          toolName: request.toolName,
          resolve: (key: string) => {
            switch (key) {
              case "y": resolve("allow"); break;
              case "t": approvedTools.add(request.toolName); resolve("allow"); break;
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
