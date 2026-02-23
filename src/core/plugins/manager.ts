/**
 * Plugin Manager — install, enable, disable, list plugins.
 */

import { mkdir, cp } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { discoverPlugins, loadPlugin } from "./loader.js";
import { registerHook } from "../hooks.js";
import type { PluginInstance } from "./types.js";

const PLUGINS_DIR = join(homedir(), ".claude-code-core", "plugins");

export class PluginManager {
  private plugins = new Map<string, PluginInstance>();
  private initialized = false;

  /**
   * Initialize — discover and load all plugins.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    await mkdir(PLUGINS_DIR, { recursive: true });
    const discovered = await discoverPlugins(PLUGINS_DIR);

    for (const plugin of discovered) {
      this.plugins.set(plugin.manifest.name, plugin);

      // Register hooks from enabled plugins
      if (plugin.enabled && plugin.hooks) {
        for (const hook of plugin.hooks) {
          registerHook(hook);
        }
      }
    }
  }

  /**
   * List all installed plugins.
   */
  list(): Array<{ name: string; description: string; enabled: boolean; version: string }> {
    return Array.from(this.plugins.values()).map((p) => ({
      name: p.manifest.name,
      description: p.manifest.description,
      enabled: p.enabled,
      version: p.manifest.version,
    }));
  }

  /**
   * Install a plugin from a local path.
   */
  async install(sourcePath: string): Promise<void> {
    const plugin = await loadPlugin(sourcePath);
    if (!plugin) {
      throw new Error(`Invalid plugin at ${sourcePath} — missing plugin.json`);
    }

    const destDir = join(PLUGINS_DIR, plugin.manifest.name);
    await mkdir(destDir, { recursive: true });
    await cp(sourcePath, destDir, { recursive: true });

    // Reload the plugin from the installed location
    const installed = await loadPlugin(destDir);
    if (installed) {
      this.plugins.set(installed.manifest.name, installed);
    }
  }

  /**
   * Enable a plugin by name.
   */
  enable(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin not found: ${name}`);
    plugin.enabled = true;

    // Register hooks
    if (plugin.hooks) {
      for (const hook of plugin.hooks) {
        registerHook(hook);
      }
    }
  }

  /**
   * Disable a plugin by name.
   */
  disable(name: string): void {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new Error(`Plugin not found: ${name}`);
    plugin.enabled = false;
    // Note: hooks are not unregistered to keep things simple.
    // A full implementation would track and remove specific hooks.
  }

  /**
   * Get tools from all enabled plugins.
   */
  getTools(): import("../../tools/tool-registry.js").Tool[] {
    const tools: import("../../tools/tool-registry.js").Tool[] = [];
    for (const plugin of this.plugins.values()) {
      if (plugin.enabled && plugin.tools) {
        tools.push(...plugin.tools);
      }
    }
    return tools;
  }
}
