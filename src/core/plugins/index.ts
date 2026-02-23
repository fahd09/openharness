/**
 * Plugin System — barrel export.
 */

export { PluginManager } from "./manager.js";
export type {
  PluginManifest,
  PluginInstance,
  Plugin,
  PluginDescriptor,
  PluginContext,
  PromptSegmentRegistration,
  PromptSegmentPosition,
  PromptBuildContext,
} from "./types.js";

import { PluginManager } from "./manager.js";

// Singleton plugin manager
let _manager: PluginManager | null = null;

export function getPluginManager(): PluginManager {
  if (!_manager) {
    _manager = new PluginManager();
  }
  return _manager;
}
