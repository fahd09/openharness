/**
 * Plugin Loader — dynamic import of plugins from disk.
 */

import { readFile, readdir, access, constants } from "fs/promises";
import { join } from "path";
import type { PluginManifest, PluginInstance } from "./types.js";

/**
 * Load a plugin manifest from a directory.
 */
export async function loadPluginManifest(
  pluginDir: string
): Promise<PluginManifest | null> {
  try {
    const manifestPath = join(pluginDir, "plugin.json");
    const content = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(content) as PluginManifest;

    if (!manifest.name || !manifest.version) {
      return null;
    }

    return manifest;
  } catch {
    return null;
  }
}

/**
 * Load a plugin from a directory.
 */
export async function loadPlugin(
  pluginDir: string
): Promise<PluginInstance | null> {
  const manifest = await loadPluginManifest(pluginDir);
  if (!manifest) return null;

  const instance: PluginInstance = {
    manifest,
    enabled: true,
    path: pluginDir,
    tools: [],
    hooks: [],
  };

  // Try to load the main entry point
  const mainFile = manifest.main ?? "index.js";
  const mainPath = join(pluginDir, mainFile);

  try {
    await access(mainPath, constants.R_OK);
    const module = await import(mainPath);

    // Collect tools
    if (module.tools && Array.isArray(module.tools)) {
      instance.tools = module.tools;
    }

    // Collect hooks
    if (module.hooks && Array.isArray(module.hooks)) {
      instance.hooks = module.hooks;
    }
  } catch {
    // Plugin has no executable code — just metadata
  }

  return instance;
}

/**
 * Discover all plugins in a directory.
 */
export async function discoverPlugins(
  baseDir: string
): Promise<PluginInstance[]> {
  const plugins: PluginInstance[] = [];

  try {
    const entries = await readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const plugin = await loadPlugin(join(baseDir, entry.name));
      if (plugin) {
        plugins.push(plugin);
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return plugins;
}
