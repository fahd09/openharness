/**
 * Console Capture — intercepts console.log/error and dispatches COMMAND_OUTPUT
 * actions so command output renders through Ink instead of fighting with it.
 *
 * This avoids rewriting all 25 command files.
 */

import type { AppAction } from "./state.js";

type LogFn = (...args: unknown[]) => void;

let originalLog: LogFn | null = null;
let originalError: LogFn | null = null;

/**
 * Start capturing console.log and console.error.
 * Captured output is dispatched as COMMAND_OUTPUT actions.
 */
export function startCapture(dispatch: (action: AppAction) => void): void {
  if (originalLog) return; // Already capturing

  originalLog = console.log;
  originalError = console.error;

  console.log = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    dispatch({ type: "COMMAND_OUTPUT", text });
  };

  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (typeof a === "string" ? a : String(a))).join(" ");
    dispatch({ type: "COMMAND_OUTPUT", text });
  };
}

/**
 * Stop capturing and restore original console methods.
 */
export function stopCapture(): void {
  if (originalLog) {
    console.log = originalLog;
    originalLog = null;
  }
  if (originalError) {
    console.error = originalError;
    originalError = null;
  }
}

/**
 * Get the original console.log (bypasses capture).
 * Useful for debug output that must go directly to stdout.
 */
export function rawLog(...args: unknown[]): void {
  const fn = originalLog ?? console.log;
  fn(...args);
}
