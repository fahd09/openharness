/**
 * Event Bridge — translates LoopEvents from the agent loop into AppActions.
 *
 * Created once per runPrompt call. The bridge receives callbacks from the
 * agent loop (onTextDelta, onThinkingDelta, onToolProgress) and LoopEvents
 * from the event loop, dispatching the appropriate state actions.
 */

import chalk from "chalk";
import type { LoopEvent } from "../core/types.js";
import type { AppAction, RetryInfo, TurnSummary, TaskItem, AgentInfo } from "./state.js";
import { StreamingRenderer } from "../core/markdown.js";
import { computePatch, formatDiff, formatDiffSummary } from "../lib/diff.js";
import { formatCost } from "../core/cost.js";
import { isThinkingDisplayEnabled } from "../commands/thinking.js";

export class EventBridge {
  public dispatch: (action: AppAction) => void;
  private streamRenderer: StreamingRenderer;
  private textStarted = false;
  private thinkingStarted = false;

  // Track pending TodoWrite operations so we can map tool_result back to tasks
  private pendingTodoOps = new Map<string, { operation: string; content?: string; id?: string; status?: string }>();

  // Track running subagents for the AgentTree
  private runningAgents = new Map<string, AgentInfo>();

  constructor(dispatch: (action: AppAction) => void) {
    this.dispatch = dispatch;

    // StreamingRenderer writes rendered lines into state
    this.streamRenderer = new StreamingRenderer((text) => {
      this.dispatch({ type: "TEXT_DELTA", line: text });
    });
  }

  /** Callback for agent loop's onTextDelta. */
  onTextDelta = (text: string): void => {
    if (this.thinkingStarted) {
      this.thinkingStarted = false;
      this.dispatch({ type: "THINKING_END" });
    }
    if (!this.textStarted) {
      this.textStarted = true;
      this.dispatch({ type: "TEXT_DELTA", line: "\n" });
    }
    this.dispatch({ type: "SPINNER_STOP" });
    this.streamRenderer.push(text);
  };

  /** Callback for agent loop's onThinkingDelta. */
  onThinkingDelta = (thinking: string): void => {
    if (!isThinkingDisplayEnabled()) return;
    if (!this.thinkingStarted) {
      this.thinkingStarted = true;
    }
    this.dispatch({ type: "SPINNER_STOP" });
    this.dispatch({ type: "THINKING_DELTA", text: thinking });
  };

  /** Callback for agent loop's onToolProgress. */
  onToolProgress = (toolName: string, toolUseId: string, content: string): void => {
    this.dispatch({ type: "SPINNER_STOP" });
    this.dispatch({ type: "TOOL_PROGRESS", toolUseId, content });

    // Track subagent progress for AgentTree
    if (toolName === "Task") {
      const existing = this.runningAgents.get(toolUseId);
      if (existing) {
        // Parse progress for tool use count (e.g., "[Bash] ..." lines)
        const isToolResult = /^\[.+\]/.test(content);
        const updated: AgentInfo = {
          ...existing,
          status: content.slice(0, 60),
          toolUseCount: isToolResult ? existing.toolUseCount + 1 : existing.toolUseCount,
          lastUpdate: Date.now(),
        };
        this.runningAgents.set(toolUseId, updated);
        this.dispatch({ type: "AGENT_UPDATE", agent: updated });
      }
    }
  };

  /** Handle a LoopEvent from the agent loop's async generator. */
  handleEvent(event: LoopEvent): void {
    switch (event.type) {
      case "tool_use_start": {
        if (!event.input) break;  // Skip streaming-time events without input

        const params = formatToolParams(event.toolName, event.input);
        let displayText = chalk.yellow(`\n\u23FA ${event.toolName}`) +
          (params ? chalk.dim(`(${params})`) : "") + "\n";

        // Show diff preview for Edit tool
        if (event.toolName === "Edit" && event.input.old_string != null && event.input.new_string != null) {
          displayText += formatEditDiff(
            String(event.input.old_string),
            String(event.input.new_string),
            String(event.input.file_path || "")
          );
        }

        // Track TodoWrite operations for TaskList integration
        if (event.toolName === "TodoWrite") {
          this.pendingTodoOps.set(event.toolUseId, {
            operation: String(event.input.operation ?? ""),
            content: event.input.content as string | undefined,
            id: event.input.id as string | undefined,
            status: event.input.status as string | undefined,
          });
        }

        // Track Task subagent launches for AgentTree
        if (event.toolName === "Task") {
          const agent: AgentInfo = {
            toolUseId: event.toolUseId,
            description: String(event.input.description ?? event.input.subagent_type ?? "subagent"),
            status: "Starting...",
            tokenCount: 0,
            toolUseCount: 0,
            startTime: Date.now(),
            lastUpdate: Date.now(),
          };
          this.runningAgents.set(event.toolUseId, agent);
          this.dispatch({ type: "AGENT_UPDATE", agent });
        }

        this.dispatch({
          type: "TOOL_USE_START",
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          params,
          displayText,
        });
        break;
      }

      case "tool_result": {
        const displayText = formatToolResult(event.toolName, event.result, event.isError);

        this.dispatch({
          type: "TOOL_RESULT",
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          displayText,
        });

        // Wire TodoWrite results → TaskList UI
        if (event.toolName === "TodoWrite" && !event.isError) {
          const op = this.pendingTodoOps.get(event.toolUseId);
          this.pendingTodoOps.delete(event.toolUseId);
          if (op) {
            this.handleTodoResult(op, event.result);
          }
        }

        // Wire Task tool completion → AgentTree removal
        if (event.toolName === "Task") {
          this.runningAgents.delete(event.toolUseId);
          this.dispatch({ type: "AGENT_REMOVE", toolUseId: event.toolUseId });
        }

        break;
      }

      case "assistant": {
        // Flush any buffered markdown
        this.streamRenderer.flush();

        this.dispatch({ type: "ASSISTANT_COMPLETE", usage: event.message.usage });

        this.textStarted = false;
        this.thinkingStarted = false;
        break;
      }

      case "thinking_delta":
        // Already handled by onThinkingDelta callback
        break;

      case "tool_progress":
        // Already handled by onToolProgress callback
        break;

      case "system": {
        if (event.subtype === "compact_boundary") {
          const { pre_tokens, post_tokens } = event.compact_metadata;
          this.dispatch({ type: "COMPACT", pre: pre_tokens, post: post_tokens });
          this.dispatch({
            type: "FREEZE_BLOCK",
            block: {
              id: `compact-${Date.now()}`,
              text: chalk.magenta(`\n\u27F3 Auto-compacted: ${pre_tokens} \u2192 ${post_tokens} tokens`),
              type: "system",
            },
          });
        }
        break;
      }

      case "retry": {
        const info: RetryInfo = {
          attempt: event.attempt,
          max: event.maxRetries,
          delayMs: event.delayMs,
          error: event.error,
        };
        this.dispatch({ type: "RETRY", info });
        this.dispatch({
          type: "FREEZE_BLOCK",
          block: {
            id: `retry-${Date.now()}`,
            text: chalk.yellow(
              `\n\u21BB Retry ${event.attempt}/${event.maxRetries} in ${(event.delayMs / 1000).toFixed(1)}s \u2014 ${event.error}`
            ),
            type: "system",
          },
        });
        break;
      }

      case "result": {
        this.dispatch({ type: "SPINNER_STOP" });

        // Show errors
        if (event.subtype !== "success" && event.resultText) {
          this.dispatch({
            type: "FREEZE_BLOCK",
            block: {
              id: `error-${Date.now()}`,
              text: chalk.red(`\n${event.resultText}`),
              type: "system",
            },
          });
        }

        // Success summary — single compact line
        if (event.subtype === "success") {
          const dur = (event.durationMs / 1000).toFixed(1);
          const u = event.totalUsage;
          const inTok = u.input_tokens.toLocaleString();
          const outTok = u.output_tokens.toLocaleString();
          const cached = u.cache_read_input_tokens ?? 0;
          const cacheStr = cached > 0 ? chalk.dim(` (${cached.toLocaleString()} cached)`) : "";
          const cost = formatCost(event.totalCostUsd);

          const line =
            chalk.dim(`\n\u273B ${dur}s \u00B7 `) +
            chalk.cyan(inTok) + chalk.dim(" in") +
            chalk.dim(" / ") +
            chalk.green(outTok) + chalk.dim(" out") +
            cacheStr +
            chalk.dim(` \u00B7 ${cost}`);

          this.dispatch({
            type: "FREEZE_BLOCK",
            block: {
              id: `summary-${Date.now()}`,
              text: line,
              type: "system",
            },
          });
        }

        const summary: TurnSummary = {
          durationSec: event.durationMs / 1000,
          totalTokens: event.totalUsage.input_tokens + event.totalUsage.output_tokens,
          costUsd: event.totalCostUsd,
        };
        this.dispatch({ type: "TURN_COMPLETE", summary });
        break;
      }
    }
  }

  /** Reset state for a new turn. */
  reset(): void {
    this.textStarted = false;
    this.thinkingStarted = false;
    this.pendingTodoOps.clear();
    this.streamRenderer = new StreamingRenderer((text) => {
      this.dispatch({ type: "TEXT_DELTA", line: text });
    });
  }

  /**
   * Parse a TodoWrite result and dispatch TASK_UPDATE actions.
   * Maps TodoWrite operations to TaskItem state changes.
   */
  private handleTodoResult(
    op: { operation: string; content?: string; id?: string; status?: string },
    result: string,
  ): void {
    switch (op.operation) {
      case "add": {
        // Result: "Added todo #1: content"
        const match = result.match(/^Added todo #(\d+): (.+)$/);
        if (match) {
          const task: TaskItem = {
            id: match[1],
            subject: match[2],
            status: "pending",
          };
          this.dispatch({ type: "TASK_UPDATE", task });
        }
        break;
      }

      case "update": {
        // Result: "Updated todo #1: [status] content"
        const match = result.match(/^Updated todo #(\d+): \[(\w+)\] (.+)$/);
        if (match) {
          const status = match[2] as "pending" | "in_progress" | "completed";
          const task: TaskItem = {
            id: match[1],
            subject: match[3],
            status,
            activeForm: status === "in_progress" ? match[3] : undefined,
            completedAt: status === "completed" ? Date.now() : undefined,
          };
          this.dispatch({ type: "TASK_UPDATE", task });
        }
        break;
      }

      case "delete": {
        // Result: "Deleted todo #1: content"
        const match = result.match(/^Deleted todo #(\d+)/);
        if (match) {
          // Mark as completed so it fades out in the UI
          const task: TaskItem = {
            id: match[1],
            subject: "(deleted)",
            status: "completed",
            completedAt: Date.now(),
          };
          this.dispatch({ type: "TASK_UPDATE", task });
        }
        break;
      }

      case "clear": {
        // All todos cleared — no individual updates needed,
        // the tasks will just stop being referenced
        break;
      }
    }
  }
}

// ── Display Formatting Helpers (ported from index.ts) ──────────────

function formatToolParams(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
      return String(input.file_path ?? "");
    case "Write":
      return String(input.file_path ?? "");
    case "Edit":
      return String(input.file_path ?? "");
    case "Bash": {
      const cmd = String(input.command ?? "");
      return cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
    }
    case "Glob":
      return String(input.pattern ?? "");
    case "Grep": {
      const pat = String(input.pattern ?? "");
      const path = input.path ? `, path=${input.path}` : "";
      const grepType = input.type ? `, type=${input.type}` : "";
      const grepGlob = input.glob ? `, glob=${input.glob}` : "";
      return `${pat}${path}${grepType}${grepGlob}`;
    }
    case "Task":
      return String(input.description ?? input.prompt ?? "").slice(0, 60);
    case "WebFetch":
      return String(input.url ?? "");
    case "WebSearch":
      return String(input.query ?? "");
    case "NotebookEdit":
      return String(input.notebook_path ?? "");
    default: {
      const firstVal = Object.values(input).find((v) => typeof v === "string");
      return firstVal ? String(firstVal).slice(0, 60) : "";
    }
  }
}

function formatEditDiff(oldStr: string, newStr: string, filePath: string): string {
  const hunks = computePatch(filePath || "file", oldStr, newStr);
  if (hunks.length === 0) return "";

  const { added, removed } = formatDiffSummary(hunks);
  const cols = process.stdout.columns || 80;
  return chalk.dim(`  ${chalk.green(`+${added}`)} ${chalk.red(`-${removed}`)}`) + "\n" +
    formatDiff(hunks, cols) + "\n";
}

function formatToolResult(toolName: string, result: string, isError: boolean): string {
  if (isError) {
    const maxPreview = 500;
    const preview = result.length > maxPreview ? result.slice(0, maxPreview) + "..." : result;
    return chalk.red(`\u2718 ${toolName}: ${preview}`);
  }

  if (toolName === "Bash") {
    const lines = result.split("\n");
    const maxLines = 5;
    let output = chalk.dim("  \u23BF Bash:") + "\n";
    if (lines.length <= maxLines + 2) {
      for (const line of lines) {
        output += chalk.dim(`  ${line}`) + "\n";
      }
    } else {
      for (let i = 0; i < maxLines; i++) {
        output += chalk.dim(`  ${lines[i]}`) + "\n";
      }
      output += chalk.dim(`  ... (${lines.length - maxLines} more lines, ${result.length} chars total)`) + "\n";
    }
    return output;
  }

  if (toolName === "Edit" || toolName === "Write") {
    return chalk.dim(`  \u23BF ${result}`);
  }

  if (toolName === "Task") {
    const lines = result.split("\n");
    const summaryLine = lines[0].startsWith("Done (") ? lines[0] : "Task complete";
    return chalk.dim(`  \u23BF ${summaryLine}`);
  }

  return chalk.dim(`  \u23BF ${toolName} (${result.length} chars)`);
}
