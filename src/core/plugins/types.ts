/**
 * Plugin System — type definitions.
 *
 * New unified Plugin interface plus legacy PluginManifest/PluginInstance
 * for external disk-based plugin compatibility.
 */

import type { Tool } from "../../tools/tool-registry.js";
import type { SlashCommand } from "../commands.js";
import type { HookHandler } from "../hooks.js";

// ── Legacy types (external disk plugins) ─────────────────────────────

export interface PluginManifest {
  /** Unique plugin name. */
  name: string;
  /** Plugin version. */
  version: string;
  /** Short description. */
  description: string;
  /** Author name. */
  author?: string;
  /** Entry point file (relative to plugin dir). */
  main?: string;
}

export interface PluginInstance {
  /** Plugin manifest. */
  manifest: PluginManifest;
  /** Whether the plugin is enabled. */
  enabled: boolean;
  /** Path to the plugin directory. */
  path: string;
  /** Tools provided by this plugin. */
  tools?: Tool[];
  /** Hooks provided by this plugin. */
  hooks?: HookHandler[];
}

// ── New unified Plugin interface ─────────────────────────────────────

/** Position controls which cache group a prompt segment belongs to. */
export type PromptSegmentPosition = "static" | "dynamic" | "volatile";

/** Registration for a prompt segment contributed by a plugin. */
export interface PromptSegmentRegistration {
  /** Unique identifier for this segment (e.g., "identity", "memory"). */
  id: string;
  /** Cache group: "static" (cached), "dynamic" (session-stable, cached), "volatile" (uncached). */
  position: PromptSegmentPosition;
  /** Sort order within position group. Lower = earlier. Default 100. */
  priority: number;
  /** Callback that returns the segment text. May be async. */
  content: (ctx: PromptBuildContext) => string | Promise<string>;
}

/** Context passed to prompt segment content callbacks. */
export interface PromptBuildContext {
  cwd: string;
  toolNames: string[];
  /** Active provider name (e.g. "anthropic", "openai", "gemini"). */
  provider?: string;
}

/** Context passed to Plugin.init(). Provides registration methods. */
export interface PluginContext {
  /** Current working directory. */
  cwd: string;
  /** Register a tool. */
  registerTool: (tool: Tool) => void;
  /** Register a slash command. */
  registerCommand: (command: SlashCommand) => void;
  /** Register a hook handler. */
  registerHook: (hook: HookHandler) => void;
  /** Register a prompt segment. */
  registerPromptSegment: (segment: PromptSegmentRegistration) => void;
}

/** Descriptor for a plugin — metadata without the init function. */
export interface PluginDescriptor {
  /** Unique plugin name. */
  name: string;
  /** Plugin version. */
  version: string;
  /** Short description. */
  description: string;
  /** Names of plugins this one depends on (init order). */
  dependencies?: string[];
}

/** The unified Plugin interface. All features register through init(). */
export interface Plugin {
  /** Plugin metadata. */
  descriptor: PluginDescriptor;
  /** Called during startup. Use ctx to register tools, commands, hooks, prompt segments. */
  init: (ctx: PluginContext) => void | Promise<void>;
}
