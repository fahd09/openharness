/**
 * Plugin Manager — unified plugin lifecycle management.
 *
 * Manages both new-style Plugin objects (built-in and external) and
 * legacy disk-based PluginInstance objects discovered via loader.ts.
 */

import { mkdir, cp } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { discoverPlugins, loadPlugin } from "./loader.js";
import { registerHook } from "../hooks.js";
import type { Tool } from "../../tools/tool-registry.js";
import type { SlashCommand } from "../commands.js";
import type { HookHandler } from "../hooks.js";
import type {
  Plugin,
  PluginContext,
  PluginInstance,
  PromptSegmentRegistration,
  PromptBuildContext,
} from "./types.js";

const PLUGINS_DIR = join(homedir(), ".claude-code-core", "plugins");

// ── Plugin Entry ─────────────────────────────────────────────────────

interface PluginEntry {
  plugin: Plugin;
  enabled: boolean;
  builtin: boolean;
  state: "registered" | "initialized" | "failed";
  /** Collected during init(). */
  tools: Tool[];
  commands: SlashCommand[];
  hooks: HookHandler[];
  promptSegments: PromptSegmentRegistration[];
}

// ── Plugin Manager ───────────────────────────────────────────────────

export class PluginManager {
  private entries = new Map<string, PluginEntry>();
  private cwd = process.cwd();
  private initialized = false;

  /** Set the working directory (before init). */
  setCwd(cwd: string): void {
    this.cwd = cwd;
  }

  /**
   * Register a built-in plugin.
   */
  registerBuiltin(plugin: Plugin): void {
    this.entries.set(plugin.descriptor.name, {
      plugin,
      enabled: true,
      builtin: true,
      state: "registered",
      tools: [],
      commands: [],
      hooks: [],
      promptSegments: [],
    });
  }

  /**
   * Register an external plugin.
   */
  register(plugin: Plugin): void {
    this.entries.set(plugin.descriptor.name, {
      plugin,
      enabled: true,
      builtin: false,
      state: "registered",
      tools: [],
      commands: [],
      hooks: [],
      promptSegments: [],
    });
  }

  /**
   * Discover and wrap legacy external plugins from ~/.claude-code-core/plugins/.
   */
  async discoverExternal(): Promise<void> {
    await mkdir(PLUGINS_DIR, { recursive: true });
    const discovered = await discoverPlugins(PLUGINS_DIR);

    for (const instance of discovered) {
      const wrapped = wrapLegacyPlugin(instance);
      this.register(wrapped);
    }
  }

  /**
   * Initialize all registered plugins.
   * Sorts by dependencies (topological order), then calls init().
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const sorted = this.topologicalSort();

    for (const name of sorted) {
      const entry = this.entries.get(name);
      if (!entry || !entry.enabled) continue;

      const ctx = this.createPluginContext(entry);

      try {
        await entry.plugin.init(ctx);
        entry.state = "initialized";

        // Register collected hooks globally
        for (const hook of entry.hooks) {
          registerHook(hook);
        }
      } catch (err) {
        entry.state = "failed";
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Plugin "${name}" failed to initialize: ${msg}`);
      }
    }
  }

  /**
   * Get all tools from enabled, initialized plugins.
   */
  getTools(): Tool[] {
    const tools: Tool[] = [];
    for (const entry of this.entries.values()) {
      if (entry.enabled && entry.state === "initialized") {
        tools.push(...entry.tools);
      }
    }
    return tools;
  }

  /**
   * Get all commands from enabled, initialized plugins.
   */
  getCommands(): SlashCommand[] {
    const commands: SlashCommand[] = [];
    for (const entry of this.entries.values()) {
      if (entry.enabled && entry.state === "initialized") {
        commands.push(...entry.commands);
      }
    }
    return commands;
  }

  /**
   * Get all prompt segments from enabled, initialized plugins,
   * sorted by position group then priority.
   */
  getPromptSegments(): PromptSegmentRegistration[] {
    const segments: PromptSegmentRegistration[] = [];
    for (const entry of this.entries.values()) {
      if (entry.enabled && entry.state === "initialized") {
        segments.push(...entry.promptSegments);
      }
    }

    // Sort by position group order, then by priority within each group
    const positionOrder: Record<string, number> = {
      static: 0,
      dynamic: 1,
      volatile: 2,
    };

    segments.sort((a, b) => {
      const posA = positionOrder[a.position] ?? 1;
      const posB = positionOrder[b.position] ?? 1;
      if (posA !== posB) return posA - posB;
      return a.priority - b.priority;
    });

    return segments;
  }

  /**
   * List all plugins with their status.
   */
  list(): Array<{
    name: string;
    description: string;
    enabled: boolean;
    version: string;
    builtin: boolean;
    state: string;
  }> {
    return Array.from(this.entries.values()).map((e) => ({
      name: e.plugin.descriptor.name,
      description: e.plugin.descriptor.description,
      enabled: e.enabled,
      version: e.plugin.descriptor.version,
      builtin: e.builtin,
      state: e.state,
    }));
  }

  /**
   * Enable a plugin by name.
   */
  enable(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not found: ${name}`);
    entry.enabled = true;
  }

  /**
   * Disable a plugin by name.
   */
  disable(name: string): void {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Plugin not found: ${name}`);
    entry.enabled = false;
  }

  /**
   * Install a legacy plugin from a local path.
   */
  async install(sourcePath: string): Promise<void> {
    const instance = await loadPlugin(sourcePath);
    if (!instance) {
      throw new Error(`Invalid plugin at ${sourcePath} — missing plugin.json`);
    }

    const destDir = join(PLUGINS_DIR, instance.manifest.name);
    await mkdir(destDir, { recursive: true });
    await cp(sourcePath, destDir, { recursive: true });

    // Reload and register
    const installed = await loadPlugin(destDir);
    if (installed) {
      const wrapped = wrapLegacyPlugin(installed);
      this.register(wrapped);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────

  private createPluginContext(entry: PluginEntry): PluginContext {
    return {
      cwd: this.cwd,
      registerTool: (tool: Tool) => entry.tools.push(tool),
      registerCommand: (command: SlashCommand) => entry.commands.push(command),
      registerHook: (hook: HookHandler) => entry.hooks.push(hook),
      registerPromptSegment: (segment: PromptSegmentRegistration) =>
        entry.promptSegments.push(segment),
    };
  }

  /**
   * Topological sort of plugins by dependencies.
   * Falls back to insertion order for plugins without dependencies.
   */
  private topologicalSort(): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) return; // Circular dep — just skip

      visiting.add(name);

      const entry = this.entries.get(name);
      if (entry) {
        const deps = entry.plugin.descriptor.dependencies ?? [];
        for (const dep of deps) {
          visit(dep);
        }
      }

      visiting.delete(name);
      visited.add(name);
      sorted.push(name);
    };

    for (const name of this.entries.keys()) {
      visit(name);
    }

    return sorted;
  }
}

// ── Legacy Plugin Wrapping ───────────────────────────────────────────

/**
 * Wrap a legacy PluginInstance into the new Plugin interface.
 */
function wrapLegacyPlugin(instance: PluginInstance): Plugin {
  return {
    descriptor: {
      name: instance.manifest.name,
      version: instance.manifest.version,
      description: instance.manifest.description,
    },
    init(ctx: PluginContext) {
      if (instance.tools) {
        for (const tool of instance.tools) {
          ctx.registerTool(tool);
        }
      }
      if (instance.hooks) {
        for (const hook of instance.hooks) {
          ctx.registerHook(hook);
        }
      }
    },
  };
}
