/**
 * Pipe Mode — non-interactive one-shot execution with legacy stdout rendering.
 */

import chalk from "chalk";
import { agentLoop } from "../core/agent-loop.js";
import { renderMarkdown } from "../core/markdown.js";
import { buildContentWithImages } from "../core/image.js";
import { disconnectMcpServers } from "../core/mcp/index.js";
import { uuid, timestamp } from "../utils.js";
import type { ConversationMessage, SystemPrompt } from "../core/types.js";
import type { ToolRegistry, PermissionRequest, PermissionResult } from "../tools/tool-registry.js";
import type { CostTracker } from "../core/cost.js";
import type { CliOptions } from "./args.js";

function resolveThinkingBudget(cliValue?: number): number | undefined {
  if (cliValue !== undefined && !isNaN(cliValue) && cliValue >= 1024) {
    return cliValue;
  }
  const envVal = process.env.CLAUDE_CODE_THINKING_BUDGET;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed >= 1024) return parsed;
  }
  return undefined;
}

export async function runPipeMode(
  opts: CliOptions,
  messages: ConversationMessage[],
  systemPrompt: SystemPrompt,
  registry: ToolRegistry,
  abortSignal: AbortSignal,
  cwd: string,
  sessionId: string,
  costTracker: CostTracker,
  permissionPrompt: ((request: PermissionRequest) => Promise<PermissionResult>) | undefined,
): Promise<void> {
  const { Spinner } = await import("../lib/spinner.js");
  const { StreamingRenderer } = await import("../core/markdown.js");
  const { isThinkingDisplayEnabled } = await import("../commands/thinking.js");

  const userInput = opts.prompt ?? "";
  if (!userInput) {
    console.error(chalk.red("No prompt provided. Use -p to specify a prompt."));
    process.exit(1);
  }

  const userContent = await buildContentWithImages(userInput);

  const userMsg: ConversationMessage = {
    type: "user",
    role: "user",
    content: typeof userContent === "string" ? userContent : userInput,
    uuid: uuid(),
    timestamp: timestamp(),
  };
  messages.push(userMsg);

  const thinkingBudget = resolveThinkingBudget(opts.thinkingBudget);
  let textStarted = false;
  let thinkingStarted = false;
  let finalResultText: string | undefined;
  const streamRenderer = new StreamingRenderer((text) => process.stdout.write(text));
  const spinner = new Spinner();
  spinner.start("Thinking...");

  try {
    for await (const event of agentLoop({
      messages,
      systemPrompt,
      tools: registry,
      model: opts.model,
      maxTurns: opts.maxTurns,
      thinkingBudgetTokens: thinkingBudget,
      requestPermission: permissionPrompt,
      signal: abortSignal,
      cwd,
      sessionId,
      costTracker,
      onTextDelta: (text) => {
        if (spinner.running) spinner.stop();
        if (thinkingStarted) {
          thinkingStarted = false;
          process.stdout.write(chalk.dim("\n\u273B Thinking complete\n"));
        }
        if (!textStarted) {
          textStarted = true;
          process.stdout.write("\n");
        }
        streamRenderer.push(text);
      },
      onThinkingDelta: (thinking) => {
        if (!isThinkingDisplayEnabled()) return;
        if (spinner.running) spinner.stop();
        if (!thinkingStarted) {
          thinkingStarted = true;
          process.stdout.write(chalk.dim("\n\uD83D\uDCAD "));
        }
        process.stdout.write(chalk.dim(thinking));
      },
      onToolProgress: (_toolName, _toolUseId, content) => {
        if (spinner.running) spinner.stop();
        const cols = process.stdout.columns || 80;
        const truncated = content.length > cols - 4 ? content.slice(0, cols - 7) + "..." : content;
        process.stdout.write(`\r\x1b[K${chalk.dim(`  \u22EF ${truncated}`)}`);
      },
    })) {
      if (event.type === "result") {
        finalResultText = event.resultText;
      }
      if (event.type === "assistant") {
        streamRenderer.flush();
        messages.push(event.message);
      }
    }
  } finally {
    if (spinner.running) spinner.stop();
  }

  if (finalResultText) {
    console.log("\n" + renderMarkdown(finalResultText));
  }
  await disconnectMcpServers();
  process.exit(0);
}
