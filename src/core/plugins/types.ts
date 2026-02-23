/**
 * Plugin System — type definitions.
 */

import type { Tool } from "../../tools/tool-registry.js";
import type { HookHandler } from "../hooks.js";

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
