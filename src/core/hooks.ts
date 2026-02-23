/**
 * Hook System — extensible lifecycle events.
 *
 * 9 hook events matching the original:
 * - PreToolUse: Before a tool executes (can modify or block)
 * - PostToolUse: After a tool executes (can inspect results)
 * - Notification: When the agent wants to notify the user
 * - UserPromptSubmit: When the user submits a prompt
 * - SessionStart: When a session begins
 * - SessionEnd: When a session ends
 * - Stop: When the agent loop stops
 * - SubagentStop: When a subagent completes
 * - PreCompact: Before conversation compaction
 *
 * Hooks are configured via:
 * - ~/.claude-code-core/hooks.json (global)
 * - .claude-code-core/hooks.json (project-local)
 * - Programmatic registration
 *
 * Each hook can run shell commands or call registered functions.
 */

import { execFile } from "child_process";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { loadClaudeSettings, getClaudeProjectSettingsPath } from "./claude-compat.js";

// ── Hook Event Types ─────────────────────────────────────────────────

export type HookEvent =
  | "PreToolUse"
  | "PostToolUse"
  | "PostToolUseFailure"
  | "Notification"
  | "UserPromptSubmit"
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStop"
  | "PreCompact";

export interface HookContext {
  event: HookEvent;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: string;
  prompt?: string;
  sessionId?: string;
  agentId?: string;
  cwd: string;
  /** Last text from the assistant (for Stop/SubagentStop). */
  lastAssistantMessage?: string;
  /** Reason the agent stopped (for Stop/SubagentStop). */
  stopReason?: string;
  /** Error message if the tool or agent failed (for PostToolUseFailure/Stop). */
  error?: string;
  /** Whether the stop was due to user interrupt. */
  isInterrupt?: boolean;
}

export type HookResult =
  | { action: "continue" }
  | { action: "block"; message: string }
  | { action: "modify"; data: unknown };

/**
 * Extended result returned from executeHooks().
 * Collects updatedInput and additionalContext across all hooks.
 */
export interface HookExecutionResult {
  action: "continue" | "block";
  message?: string;
  /** Modified tool input from PreToolUse hooks. */
  updatedInput?: unknown;
  /** Extra context strings to inject into the conversation. */
  additionalContext?: string[];
}

export interface HookHandler {
  event: HookEvent;
  /** Hook type: "command" (shell), "prompt" (LLM), or "handler" (programmatic). Auto-inferred from fields. */
  type?: "command" | "prompt" | "handler";
  /** Shell command to execute. Receives JSON context via stdin. */
  command?: string;
  /** LLM prompt template. `$ARGUMENTS` is replaced with the hook context JSON. */
  prompt?: string;
  /** Model for prompt-type hooks (default: claude-haiku-4-5-20251001). */
  model?: string;
  /** Timeout in ms for prompt-type hooks (default: 10000). */
  timeout?: number;
  /** Programmatic handler function. */
  handler?: (context: HookContext) => Promise<HookResult>;
  /** Only trigger for specific tool names (for Pre/PostToolUse). */
  toolFilter?: string[];
}

// ── Hook Registry ────────────────────────────────────────────────────

const registeredHooks: HookHandler[] = [];

// ── Stop Hook Guard ─────────────────────────────────────────────────
// Prevents infinite loops when a Stop hook blocks and re-runs the loop.
let stopHookActive = false;
export function isStopHookActive(): boolean { return stopHookActive; }
export function setStopHookActive(v: boolean): void { stopHookActive = v; }

/**
 * Register a hook handler programmatically.
 */
export function registerHook(hook: HookHandler): void {
  registeredHooks.push(hook);
}

/**
 * Clear all registered hooks.
 */
export function clearHooks(): void {
  registeredHooks.length = 0;
  scopedHooks.clear();
}

// ── Scoped Hooks ────────────────────────────────────────────────────
// Per-agent hooks that are automatically cleaned up when the agent finishes.

const scopedHooks = new Map<string, HookHandler[]>();

/**
 * Register hooks scoped to a specific agent/scope ID.
 * These hooks are added to the global registry and tracked for cleanup.
 */
export function registerScopedHooks(scopeId: string, hooks: HookHandler[]): void {
  scopedHooks.set(scopeId, hooks);
  for (const hook of hooks) {
    registeredHooks.push(hook);
  }
}

/**
 * Unregister all hooks for a given scope ID.
 * Removes them from the global registry.
 */
export function unregisterScopedHooks(scopeId: string): void {
  const hooks = scopedHooks.get(scopeId);
  if (!hooks) return;

  for (const hook of hooks) {
    const idx = registeredHooks.indexOf(hook);
    if (idx !== -1) registeredHooks.splice(idx, 1);
  }
  scopedHooks.delete(scopeId);
}

/**
 * Load hooks from config files.
 *
 * Sources (in order):
 * 1. ~/.claude-code-core/hooks.json (global native)
 * 2. .claude-code-core/hooks.json (project native)
 * 3. <cwd>/.claude/settings.local.json → hooks key (Claude Code compat)
 */
export async function loadHooksFromConfig(cwd: string): Promise<void> {
  const paths = [
    join(homedir(), ".claude-code-core", "hooks.json"),
    join(cwd, ".claude-code-core", "hooks.json"),
  ];

  for (const configPath of paths) {
    try {
      const content = await readFile(configPath, "utf-8");
      const config = JSON.parse(content) as HookHandler[];
      if (Array.isArray(config)) {
        for (const hook of config) {
          if (!hook.event) continue;
          // Auto-infer type from fields for backward compatibility
          if (!hook.type) {
            if (hook.command) hook.type = "command";
            else if (hook.prompt) hook.type = "prompt";
            else if (hook.handler) hook.type = "handler";
          }
          if (hook.command || hook.prompt || hook.handler) {
            registeredHooks.push(hook);
          }
        }
      }
    } catch {
      // Config file doesn't exist or is invalid — skip
    }
  }

  // Also load hooks from Claude Code's settings.local.json
  const settings = await loadClaudeSettings(getClaudeProjectSettingsPath(cwd));
  if (settings && typeof settings.hooks === "object" && settings.hooks !== null) {
    const hooksConfig = settings.hooks as Record<string, unknown>;
    // Claude Code hooks are keyed by event name, each containing an array of hook handlers
    for (const [event, handlers] of Object.entries(hooksConfig)) {
      if (!Array.isArray(handlers)) continue;
      for (const hook of handlers) {
        if (typeof hook !== "object" || hook === null) continue;
        const h = hook as Record<string, unknown>;
        const hookHandler: HookHandler = {
          event: event as HookEvent,
          type: h.type as HookHandler["type"],
          command: h.command as string | undefined,
          prompt: h.prompt as string | undefined,
          model: h.model as string | undefined,
          timeout: h.timeout as number | undefined,
          toolFilter: Array.isArray(h.matcher) ? h.matcher as string[] : undefined,
        };
        // Auto-infer type
        if (!hookHandler.type) {
          if (hookHandler.command) hookHandler.type = "command";
          else if (hookHandler.prompt) hookHandler.type = "prompt";
        }
        if (hookHandler.command || hookHandler.prompt) {
          registeredHooks.push(hookHandler);
        }
      }
    }
  }
}

/**
 * Execute all hooks for a given event.
 *
 * Returns an extended result:
 * - If any hook blocks, returns block immediately
 * - Collects updatedInput from the last modify/updatedInput
 * - Collects additionalContext from all hooks
 */
export async function executeHooks(
  context: HookContext
): Promise<HookExecutionResult> {
  const matchingHooks = registeredHooks.filter((h) => {
    if (h.event !== context.event) return false;
    // Apply tool filter for Pre/PostToolUse
    if (
      h.toolFilter &&
      context.toolName &&
      !h.toolFilter.includes(context.toolName)
    ) {
      return false;
    }
    return true;
  });

  let updatedInput: unknown | undefined;
  const additionalContext: string[] = [];

  for (const hook of matchingHooks) {
    try {
      let result: HookResult;

      if (hook.handler) {
        result = await hook.handler(context);
      } else if (hook.type === "prompt" && hook.prompt) {
        const { evaluatePromptHook } = await import("./hook-prompt.js");
        const promptResult = await evaluatePromptHook(
          { prompt: hook.prompt, model: hook.model, timeout: hook.timeout },
          JSON.stringify(context)
        );
        if (!promptResult.ok) {
          result = { action: "block", message: promptResult.reason ?? "Blocked by prompt hook" };
        } else {
          result = { action: "continue" };
        }
        // Prompt hooks can also provide additionalContext
        if (promptResult.additionalContext) {
          additionalContext.push(...promptResult.additionalContext);
        }
      } else if (hook.command) {
        result = await executeShellHook(hook.command, context);
      } else {
        continue;
      }

      if (result.action === "block") {
        return { action: "block", message: (result as { message: string }).message };
      }
      if (result.action === "modify") {
        // Backward compat: "modify" maps to updatedInput
        updatedInput = (result as { data: unknown }).data;
      }

      // Shell hooks can return updatedInput and additionalContext in JSON
      const extResult = result as Record<string, unknown>;
      if (extResult.updatedInput !== undefined) {
        updatedInput = extResult.updatedInput;
      }
      if (Array.isArray(extResult.additionalContext)) {
        additionalContext.push(...(extResult.additionalContext as string[]));
      }
    } catch (err) {
      // Hook errors don't block execution, but we log them
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Hook error (${hook.event}): ${msg}`);
    }
  }

  return {
    action: "continue",
    updatedInput: updatedInput,
    additionalContext: additionalContext.length > 0 ? additionalContext : undefined,
  };
}

/**
 * Execute a shell command hook.
 * Passes context as JSON via stdin, reads JSON result from stdout.
 */
async function executeShellHook(
  command: string,
  context: HookContext
): Promise<HookResult> {
  return new Promise((resolve) => {
    const child = execFile(
      "/bin/bash",
      ["-c", command],
      {
        cwd: context.cwd,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          HOOK_EVENT: context.event,
          HOOK_TOOL_NAME: context.toolName ?? "",
          HOOK_SESSION_ID: context.sessionId ?? "",
        },
      },
      (error, stdout) => {
        if (error) {
          resolve({ action: "continue" });
          return;
        }

        try {
          const result = JSON.parse(stdout.trim());
          if (result.action === "block" && result.message) {
            resolve({ action: "block", message: result.message });
          } else if (result.action === "modify" && result.data !== undefined) {
            // Include updatedInput/additionalContext if present
            resolve({
              action: "modify",
              data: result.data,
              ...( result.updatedInput !== undefined && { updatedInput: result.updatedInput }),
              ...( Array.isArray(result.additionalContext) && { additionalContext: result.additionalContext }),
            } as HookResult);
          } else {
            // Even "continue" can carry updatedInput/additionalContext
            resolve({
              action: "continue",
              ...( result.updatedInput !== undefined && { updatedInput: result.updatedInput }),
              ...( Array.isArray(result.additionalContext) && { additionalContext: result.additionalContext }),
            } as HookResult);
          }
        } catch {
          // Non-JSON output = continue
          resolve({ action: "continue" });
        }
      }
    );

    // Pass context as stdin
    child.stdin?.write(JSON.stringify(context));
    child.stdin?.end();
  });
}
