/**
 * Event Bridge — translates LoopEvents from the agent loop into AppActions.
 *
 * Created once per runPrompt call. The bridge receives callbacks from the
 * agent loop (onTextDelta, onThinkingDelta, onToolProgress) and LoopEvents
 * from the event loop, dispatching the appropriate state actions.
 *
 * Delegates TodoWrite and Task tracking to focused sub-bridges.
 */

import chalk from "chalk";
import type { LoopEvent } from "../core/types.js";
import type { AppAction, RetryInfo, TurnSummary } from "./state.js";
import { StreamingRenderer } from "../core/markdown.js";
import { computePatch, formatDiff, formatDiffSummary } from "../lib/diff.js";
import { formatCost } from "../core/cost.js";
import { isThinkingDisplayEnabled } from "../commands/thinking.js";
import { TodoBridge } from "./bridges/todo-bridge.js";
import { AgentBridge } from "./bridges/agent-bridge.js";

export class EventBridge {
  public dispatch: (action: AppAction) => void;
  private streamRenderer: StreamingRenderer;
  private textStarted = false;
  private thinkingStarted = false;
  private todoBridge = new TodoBridge();
  private agentBridge = new AgentBridge();

  constructor(dispatch: (action: AppAction) => void) {
    this.dispatch = dispatch;

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

    if (toolName === "Task") {
      this.agentBridge.trackProgress(toolUseId, content, this.dispatch);
    }
  };

  /** Handle a LoopEvent from the agent loop's async generator. */
  handleEvent(event: LoopEvent): void {
    switch (event.type) {
      case "tool_use_start": {
        if (!event.input) break;

        const params = formatToolParams(event.toolName, event.input);
        let displayText = chalk.yellow(`\n\u23FA ${event.toolName}`) +
          (params ? chalk.dim(`(${params})`) : "") + "\n";

        if (event.toolName === "Edit" && event.input.old_string != null && event.input.new_string != null) {
          displayText += formatEditDiff(
            String(event.input.old_string),
            String(event.input.new_string),
            String(event.input.file_path || "")
          );
        }

        if (event.toolName === "TodoWrite") {
          this.todoBridge.trackStart(event.toolUseId, event.input);
        }

        if (event.toolName === "Task") {
          this.agentBridge.trackStart(event.toolUseId, event.input, this.dispatch);
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

        if (event.toolName === "TodoWrite" && !event.isError) {
          this.todoBridge.handleResult(event.toolUseId, event.result, this.dispatch);
        }

        if (event.toolName === "Task") {
          this.agentBridge.trackComplete(event.toolUseId, this.dispatch);
        }

        break;
      }

      case "assistant": {
        this.streamRenderer.flush();
        this.dispatch({ type: "ASSISTANT_COMPLETE", usage: event.message.usage });
        this.textStarted = false;
        this.thinkingStarted = false;
        break;
      }

      case "thinking_delta":
      case "tool_progress":
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

        if (event.subtype === "success") {
          const dur = (event.durationMs / 1000).toFixed(1);
          const u = event.totalUsage;
          const inTok = u.input_tokens.toLocaleString();
          const outTok = u.output_tokens.toLocaleString();
          const cached = u.cache_read_input_tokens ?? 0;
          const cacheWrite = u.cache_creation_input_tokens ?? 0;
          const cost = formatCost(event.totalCostUsd);

          // Build a detailed cache breakdown when caching is active
          let cacheDetail = "";
          if (cached > 0 || cacheWrite > 0) {
            const parts: string[] = [];
            if (cached > 0) parts.push(`${cached.toLocaleString()} cached`);
            if (cacheWrite > 0) parts.push(`${cacheWrite.toLocaleString()} new`);
            const fresh = u.input_tokens - cached - cacheWrite;
            if (fresh > 0) parts.push(`${fresh.toLocaleString()} fresh`);
            cacheDetail = chalk.dim(` [${parts.join(" · ")}]`);
          }

          const line =
            chalk.dim(`\n\u273B ${dur}s \u00B7 `) +
            chalk.cyan(inTok) + chalk.dim(" in") +
            cacheDetail +
            chalk.dim(" / ") +
            chalk.green(outTok) + chalk.dim(" out") +
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
    this.todoBridge.clear();
    this.agentBridge.clear();
    this.streamRenderer = new StreamingRenderer((text) => {
      this.dispatch({ type: "TEXT_DELTA", line: text });
    });
  }
}

// ── Display Formatting Helpers ──────────────────────────────────────

function formatToolParams(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case "Read":
    case "Write":
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
    case "TaskOutput":
    case "TaskStop":
      return String(input.task_id ?? input.shell_id ?? "");
    case "AskUserQuestion": {
      const questions = input.questions as Array<{ question?: string }> | undefined;
      if (questions && questions.length > 0) {
        return String(questions[0].question ?? "").slice(0, 60);
      }
      return "";
    }
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

  if (toolName === "AskUserQuestion") {
    try {
      const answers = JSON.parse(result);
      const entries = Object.entries(answers);
      if (entries.length > 0) {
        const summary = entries.map(([q, a]) => `${q}: ${a}`).join("; ");
        return chalk.dim(`  \u23BF Answers: ${summary.slice(0, 120)}`);
      }
    } catch {}
    return chalk.dim(`  \u23BF AskUserQuestion (${result.length} chars)`);
  }

  return chalk.dim(`  \u23BF ${toolName} (${result.length} chars)`);
}
