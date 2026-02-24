/**
 * Agent Bridge — tracks Task/subagent lifecycle for the AgentTree UI.
 */

import type { AppAction, AgentInfo } from "../state.js";

export class AgentBridge {
  private runningAgents = new Map<string, AgentInfo>();

  /** Track a Task tool_use_start (subagent launch). */
  trackStart(
    toolUseId: string,
    input: Record<string, unknown>,
    dispatch: (action: AppAction) => void,
  ): void {
    const agent: AgentInfo = {
      toolUseId,
      description: String(input.description ?? input.subagent_type ?? "subagent"),
      status: "Starting...",
      tokenCount: 0,
      toolUseCount: 0,
      startTime: Date.now(),
      lastUpdate: Date.now(),
    };
    this.runningAgents.set(toolUseId, agent);
    dispatch({ type: "AGENT_UPDATE", agent });
  }

  /** Update agent progress from onToolProgress callback. */
  trackProgress(
    toolUseId: string,
    content: string,
    dispatch: (action: AppAction) => void,
  ): void {
    const existing = this.runningAgents.get(toolUseId);
    if (!existing) return;

    const isToolResult = /^\[.+\]/.test(content);
    const updated: AgentInfo = {
      ...existing,
      status: content.slice(0, 60),
      toolUseCount: isToolResult ? existing.toolUseCount + 1 : existing.toolUseCount,
      lastUpdate: Date.now(),
    };
    this.runningAgents.set(toolUseId, updated);
    dispatch({ type: "AGENT_UPDATE", agent: updated });
  }

  /** Remove a completed subagent. */
  trackComplete(
    toolUseId: string,
    dispatch: (action: AppAction) => void,
  ): void {
    this.runningAgents.delete(toolUseId);
    dispatch({ type: "AGENT_REMOVE", toolUseId });
  }

  clear(): void {
    this.runningAgents.clear();
  }
}
