/**
 * Background Task Registry — unified facade over shell-registry (background
 * shells) and a local map of background agents.
 *
 * Shell IDs are numeric strings ("1", "2", ...) while agent IDs are short
 * hex UUIDs ("a3f4b2c"), so there is no collision.
 */

import { getShell, killShell, listShells, type ShellEntry } from "./shell-registry.js";

// ── Background Agent Tracking ───────────────────────────────────────

export interface BackgroundAgentEntry {
  id: string;
  outputFile: string;
  abortController: AbortController;
  description: string;
  finished: boolean;
  startedAt: string;
  error?: string;
}

const agents = new Map<string, BackgroundAgentEntry>();

export function registerBackgroundAgent(
  id: string,
  outputFile: string,
  abortController: AbortController,
  description: string,
): void {
  agents.set(id, {
    id,
    outputFile,
    abortController,
    description,
    finished: false,
    startedAt: new Date().toISOString(),
  });
}

export function getBackgroundAgent(id: string): BackgroundAgentEntry | undefined {
  return agents.get(id);
}

export function markAgentFinished(id: string, error?: string): void {
  const entry = agents.get(id);
  if (entry) {
    entry.finished = true;
    if (error) entry.error = error;
  }
}

// ── Unified Lookup / Stop ───────────────────────────────────────────

export type BackgroundTask =
  | { kind: "shell"; entry: ShellEntry }
  | { kind: "agent"; entry: BackgroundAgentEntry };

export function getBackgroundTask(taskId: string): BackgroundTask | undefined {
  const shell = getShell(taskId);
  if (shell) return { kind: "shell", entry: shell };

  const agent = agents.get(taskId);
  if (agent) return { kind: "agent", entry: agent };

  return undefined;
}

/**
 * List all background tasks (shells + agents).
 */
export function listAllBackgroundTasks(): BackgroundTask[] {
  const tasks: BackgroundTask[] = [];
  for (const shell of listShells()) {
    tasks.push({ kind: "shell", entry: shell });
  }
  for (const agent of agents.values()) {
    tasks.push({ kind: "agent", entry: agent });
  }
  return tasks;
}

export function stopBackgroundTask(taskId: string): boolean {
  // Try shell first
  const shell = getShell(taskId);
  if (shell) {
    if (shell.finished) return true;
    return killShell(taskId);
  }

  // Try agent
  const agent = agents.get(taskId);
  if (agent) {
    if (agent.finished) return true;
    agent.abortController.abort();
    agent.finished = true;
    return true;
  }

  return false;
}
