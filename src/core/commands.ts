/**
 * Command Registry — framework for slash commands.
 *
 * Replaces inline if/else blocks in index.ts with a structured registry.
 * Each command implements the SlashCommand interface and is registered
 * in the CommandRegistry. Commands receive a CommandContext with all
 * mutable session state needed for execution.
 */

import type { ConversationMessage, SystemPrompt, PromptSegmentDetail } from "./types.js";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { PermissionRequest, PermissionResult } from "../tools/tool-registry.js";
import type { CostTracker } from "./cost.js";
import type { FileChangeTracker } from "./file-tracker.js";
import type { AppAction } from "../ui/state.js";
import type * as readline from "readline";

// ── Interfaces ──────────────────────────────────────────────────────

export interface CommandContext {
  /** Current conversation messages (mutable). */
  messages: ConversationMessage[];
  /** Current model identifier. */
  model: string;
  /** Mutable — allows /model to change the active model. */
  setModel: (model: string) => void;
  /** Session-level cost tracker. */
  costTracker: CostTracker;
  /** File change tracker. */
  fileTracker: FileChangeTracker;
  /** System prompt segments. */
  systemPrompt: SystemPrompt;
  /** Per-plugin-segment details for token breakdown. */
  promptSegmentDetails: PromptSegmentDetail[];
  /** Readline interface for interactive prompts (optional — may not be available in Ink mode). */
  rl?: readline.Interface;
  /** Current working directory. */
  cwd: string;
  /** Current session ID. */
  sessionId: string;
  /** Tool registry. */
  toolRegistry: ToolRegistry;
  /** Permission mode name. */
  permissionMode: string;
  /** Permission prompt callback. */
  requestPermission?: (request: PermissionRequest) => Promise<PermissionResult>;
  /** Function to run a prompt through the agent loop. */
  runPrompt: (prompt: string) => Promise<string | undefined>;
  /**
   * Output text to the UI. Preferred over console.log in Ink mode.
   * Falls back to console.log if not provided.
   */
  output?: (text: string) => void;
  /** Switch the active session ID (used by /fork, /rewind). */
  setSessionId?: (id: string) => void;
  /** Dispatch UI actions (Ink mode only). */
  dispatch?: (action: AppAction) => void;
  /** Rebuild the system prompt (e.g. after provider switch). */
  rebuildSystemPrompt?: () => Promise<void>;
}

export interface SlashCommand {
  /** Command name without the leading slash. */
  name: string;
  /** Short description for /help. */
  description: string;
  /** Category for grouped help display. */
  category: "session" | "model" | "info" | "tools" | "other";
  /** Aliases (without leading slash). */
  aliases?: string[];
  /** Static argument completions for tab completion. */
  completions?: string[];
  /** Execute the command. Returns true if the REPL should re-prompt. */
  execute(args: string, ctx: CommandContext): Promise<boolean>;
}

// ── Registry ────────────────────────────────────────────────────────

export class CommandRegistry {
  private commands = new Map<string, SlashCommand>();
  private aliasMap = new Map<string, string>();

  register(cmd: SlashCommand): void {
    this.commands.set(cmd.name, cmd);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        this.aliasMap.set(alias, cmd.name);
      }
    }
  }

  /**
   * Try to execute a slash command.
   * Returns null if the input is not a registered command.
   * Returns boolean (should re-prompt) if it was a command.
   */
  async execute(input: string, ctx: CommandContext): Promise<boolean | null> {
    if (!input.startsWith("/")) return null;

    const spaceIdx = input.indexOf(" ");
    const cmdName = (spaceIdx === -1 ? input : input.slice(0, spaceIdx))
      .slice(1)
      .toLowerCase();
    const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();

    // Resolve alias
    const resolved = this.aliasMap.get(cmdName) ?? cmdName;
    const cmd = this.commands.get(resolved);

    if (!cmd) return null;

    return cmd.execute(args, ctx);
  }

  /** Get all registered commands (for help, tab completion). */
  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /** Get all command names including aliases (for tab completion). */
  getAllNames(): string[] {
    const names: string[] = [];
    for (const cmd of this.commands.values()) {
      names.push(`/${cmd.name}`);
      if (cmd.aliases) {
        for (const alias of cmd.aliases) {
          names.push(`/${alias}`);
        }
      }
    }
    return names;
  }

  /** Get argument completions for a command (resolves aliases). */
  getCompletions(cmdName: string): string[] | undefined {
    const resolved = this.aliasMap.get(cmdName) ?? cmdName;
    const cmd = this.commands.get(resolved);
    return cmd?.completions;
  }
}
