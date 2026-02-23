import type { z, ZodObject, ZodRawShape } from "zod";
import { truncate } from "../utils.js";
import type { ApiToolUseBlock } from "../core/types.js";

// ── Tool output types ───────────────────────────────────────────────

/** Yielded by tool generators during execution. */
export type ToolOutput =
  | { type: "progress"; content: string } // Transient display update
  | { type: "result"; content: string }; // Final result for AI

// ── Permission system ───────────────────────────────────────────────

export interface PermissionRequest {
  toolName: string;
  input: unknown;
  /** Human-readable summary of what the tool wants to do. */
  description: string;
}

export type PermissionResult = "allow" | "deny" | "allow_all";

/**
 * Callback to request user permission before executing a non-read-only tool.
 * Returns "allow" (this once), "deny" (reject), or "allow_all" (skip future prompts).
 */
export type PermissionCallback = (
  request: PermissionRequest
) => Promise<PermissionResult>;

// ── Tool context ────────────────────────────────────────────────────

export interface ToolContext {
  cwd: string;
  abortSignal?: AbortSignal;
  agentId?: string;
  /**
   * Permission callback. Called before non-read-only tools execute.
   * If undefined, all tools are auto-approved (e.g., in subagent context).
   */
  requestPermission?: PermissionCallback;
  /**
   * Parent conversation messages. Available when tools are executed
   * within an agent loop. Used by the Task tool to implement forkContext:
   * when true, the subagent receives the parent's conversation history.
   */
  parentMessages?: import("../core/types.js").ConversationMessage[];
  /**
   * Session-scoped set of files that have been read.
   * Write and Edit tools check this to enforce read-before-write.
   */
  readFiles?: Set<string>;
  /**
   * Hook callback fired before a tool executes.
   * Can return "block" to prevent execution, or provide updatedInput.
   */
  onPreToolUse?: (toolName: string, input: unknown) => Promise<
    | { action: "continue"; updatedInput?: unknown }
    | { action: "block"; message: string }
  >;
  /**
   * Hook callback fired after a tool executes successfully.
   * Returns optional additionalContext strings to inject into conversation.
   */
  onPostToolUse?: (toolName: string, input: unknown, result: string, isError: boolean) => Promise<string[] | void>;
  /**
   * Hook callback fired when a tool execution fails (error/interrupt).
   * Returns optional additionalContext strings to inject into conversation.
   */
  onPostToolUseFailure?: (toolName: string, input: unknown, error: string, isInterrupt: boolean) => Promise<string[] | void>;
  /** Called when a tool yields a progress update during execution. */
  onProgress?: (toolName: string, toolUseId: string, content: string) => void;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  maxResultSizeChars: number;
  isConcurrencySafe?: (input: unknown) => boolean;
  isReadOnly?: (input: unknown) => boolean;
  call(input: unknown, context: ToolContext): AsyncGenerator<ToolOutput>;
}

export interface ToolResult {
  toolUseId: string;
  toolName: string;
  content: string;
  isError: boolean;
}

/** Convert a Zod schema to a JSON Schema object for the Claude API */
export function zodToJsonSchema(schema: ZodObject<ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const zodType = value as z.ZodTypeAny;
    properties[key] = zodFieldToJsonSchema(zodType);
    if (!zodType.isOptional()) {
      required.push(key);
    }
  }

  return {
    type: "object",
    properties,
    required: required.length > 0 ? required : undefined,
  };
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): Record<string, unknown> {
  const def = field._def;
  const typeName = def.typeName as string;

  if (typeName === "ZodOptional") {
    return zodFieldToJsonSchema(def.innerType);
  }
  if (typeName === "ZodNullable") {
    return { ...zodFieldToJsonSchema(def.innerType), nullable: true };
  }
  if (typeName === "ZodDefault") {
    const inner = zodFieldToJsonSchema(def.innerType);
    return { ...inner, default: def.defaultValue() };
  }

  const description = field.description;
  const base: Record<string, unknown> = {};
  if (description) base.description = description;

  switch (typeName) {
    case "ZodString":
      return { ...base, type: "string" };
    case "ZodNumber":
      return { ...base, type: "number" };
    case "ZodBoolean":
      return { ...base, type: "boolean" };
    case "ZodEnum":
      return { ...base, type: "string", enum: def.values };
    case "ZodArray":
      return { ...base, type: "array", items: zodFieldToJsonSchema(def.type) };
    case "ZodLiteral":
      return { ...base, type: typeof def.value, const: def.value };
    default:
      return { ...base, type: "string" };
  }
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  remove(name: string): void {
    this.tools.delete(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getToolSchemas(): Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }> {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: zodToJsonSchema(tool.inputSchema),
    }));
  }
}

// ── Tool Execution Queue ────────────────────────────────────────────
// Mirrors original's bp6 (ToolExecutionQueue) class.
//
// Rules:
// 1. Concurrent-safe tools can run in parallel with other concurrent-safe tools
// 2. Non-concurrent tools must run alone (wait for all executing to finish)
// 3. A non-concurrent tool in the queue blocks everything behind it
// 4. Concurrency is capped at CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY (default: 10)

const DEFAULT_MAX_CONCURRENCY = 10;

function getMaxConcurrency(): number {
  const env = process.env.CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_MAX_CONCURRENCY;
}

interface QueuedTool {
  block: ApiToolUseBlock;
  isConcurrencySafe: boolean;
  resolve: (result: ToolResult) => void;
}

/**
 * Execute tool use blocks via a queue-based executor.
 *
 * Matches original's bp6 pattern:
 * - canExecuteTool: checks if a new tool can start (no executing, or all concurrent-safe)
 * - processQueue: iterates queued tools, starting those that can run
 * - Non-concurrent tools block the queue until they complete
 * - Concurrency capped at CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY (default: 10)
 */
/** Build an abort result for a tool that was skipped due to abort signal. */
function abortResult(block: ApiToolUseBlock): ToolResult {
  return {
    toolUseId: block.id,
    toolName: block.name,
    content: "Tool execution was aborted.",
    isError: true,
  };
}

export async function executeToolUseBlocks(
  blocks: ApiToolUseBlock[],
  registry: ToolRegistry,
  context: ToolContext
): Promise<ToolResult[]> {
  const maxConcurrency = getMaxConcurrency();

  // Classify each block
  const classified = blocks.map((block) => {
    const tool = registry.get(block.name);
    const isSafe = tool?.isConcurrencySafe?.(block.input) ?? false;
    return { block, isConcurrencySafe: isSafe };
  });

  // Fast path: single tool or all sequential
  if (classified.length === 1) {
    if (context.abortSignal?.aborted) {
      return [abortResult(classified[0].block)];
    }
    return [await executeSingleTool(classified[0].block, registry, context)];
  }

  const results: ToolResult[] = new Array(blocks.length);
  const executing = new Set<number>(); // indices currently running
  let nextIdx = 0;

  /**
   * Can we start tool at `idx`?
   * - If nothing executing: always yes
   * - If tool is concurrent-safe AND all executing are concurrent-safe
   *   AND we haven't hit the cap: yes
   * - Otherwise: no
   */
  function canStart(idx: number): boolean {
    if (executing.size === 0) return true;

    const entry = classified[idx];
    if (!entry.isConcurrencySafe) return false;

    // Check all currently executing are also concurrent-safe
    for (const execIdx of executing) {
      if (!classified[execIdx].isConcurrencySafe) return false;
    }

    // Check concurrency cap
    if (executing.size >= maxConcurrency) return false;

    return true;
  }

  // Process queue using a loop that waits for slots to open
  while (nextIdx < classified.length) {
    // Check abort before dequeuing — skip remaining tools
    if (context.abortSignal?.aborted) {
      for (let i = nextIdx; i < classified.length; i++) {
        results[i] = abortResult(classified[i].block);
      }
      break;
    }

    // Try to start as many tools as possible from the front of the queue
    const batch: Promise<void>[] = [];

    while (nextIdx < classified.length && canStart(nextIdx)) {
      // Check abort before each individual tool start
      if (context.abortSignal?.aborted) break;

      const idx = nextIdx;
      nextIdx++;
      executing.add(idx);

      const promise = executeSingleTool(
        classified[idx].block,
        registry,
        context
      ).then((result) => {
        results[idx] = result;
        executing.delete(idx);
      });

      batch.push(promise);

      // If the tool we just started is NOT concurrent-safe, it must run alone
      // — don't start any more until it finishes
      if (!classified[idx].isConcurrencySafe) break;
    }

    // Wait for at least one tool to complete (opens a slot)
    if (batch.length > 0) {
      // If the batch contains a non-concurrent tool (which will be the only
      // one in the batch), wait for it specifically. Otherwise wait for any.
      if (batch.length === 1) {
        await batch[0];
      } else {
        // Wait for ALL concurrent tools in this batch, since we need all
        // results and the next tool might be non-concurrent
        await Promise.all(batch);
      }
    } else if (executing.size > 0) {
      // Can't start next tool yet — wait for all currently executing to finish
      // This happens when the next tool is non-concurrent but concurrent tools
      // are still running from a previous batch
      await waitForAll(executing);
    }
  }

  // Wait for any remaining executing tools
  if (executing.size > 0) {
    await waitForAll(executing);
  }

  return results;
}

/**
 * Helper: wait for all currently executing tools to complete.
 * Used when a non-concurrent tool needs to run but concurrent tools are still going.
 */
async function waitForAll(_executing: Set<number>): Promise<void> {
  // The executing set is modified by the .then() callbacks on the promises
  // We just need to wait until it drains
  while (_executing.size > 0) {
    await new Promise((r) => setTimeout(r, 1));
  }
}

/**
 * Build a human-readable description of what a tool wants to do,
 * for display in the permission prompt.
 */
function formatPermissionDescription(
  toolName: string,
  input: Record<string, unknown>
): string {
  switch (toolName) {
    case "Bash":
      return `${input.command ?? "(unknown command)"}`;
    case "Write":
      return `Write to ${input.file_path ?? "(unknown file)"}`;
    case "Edit":
      return `Edit ${input.file_path ?? "(unknown file)"}`;
    case "Task":
      return `Spawn subagent: ${input.description ?? input.prompt ?? "(unknown task)"}`;
    default:
      return `Execute ${toolName}`;
  }
}

async function executeSingleTool(
  block: ApiToolUseBlock,
  registry: ToolRegistry,
  context: ToolContext
): Promise<ToolResult> {
  const tool = registry.get(block.name);
  if (!tool) {
    return {
      toolUseId: block.id,
      toolName: block.name,
      content: `Error: Unknown tool "${block.name}"`,
      isError: true,
    };
  }

  try {
    const parseResult = tool.inputSchema.safeParse(block.input);
    if (!parseResult.success) {
      return {
        toolUseId: block.id,
        toolName: block.name,
        content: `InputValidationError: ${parseResult.error.message}`,
        isError: true,
      };
    }

    // Effective input (may be modified by PreToolUse hook)
    let effectiveInput = parseResult.data;

    // ── PreToolUse hook ────────────────────────────────────────
    if (context.onPreToolUse) {
      const hookResult = await context.onPreToolUse(tool.name, effectiveInput);
      if (hookResult.action === "block") {
        return {
          toolUseId: block.id,
          toolName: block.name,
          content: `Blocked by hook: ${hookResult.message}`,
          isError: true,
        };
      }
      // Apply updatedInput if provided
      if (hookResult.updatedInput !== undefined) {
        const reparse = tool.inputSchema.safeParse(hookResult.updatedInput);
        if (reparse.success) {
          effectiveInput = reparse.data;
        }
      }
    }

    // ── Permission check for non-read-only tools ─────────────
    const isReadOnly = tool.isReadOnly?.(effectiveInput) ?? false;
    if (!isReadOnly && context.requestPermission) {
      const description = formatPermissionDescription(
        tool.name,
        effectiveInput as Record<string, unknown>
      );
      const permission = await context.requestPermission({
        toolName: tool.name,
        input: effectiveInput,
        description,
      });
      if (permission === "deny") {
        return {
          toolUseId: block.id,
          toolName: block.name,
          content: "Permission denied by user.",
          isError: true,
        };
      }
      // "allow" and "allow_all" both proceed — "allow_all" is handled
      // by the caller (it removes the callback for future calls)
    }

    let finalResult = "";
    for await (const output of tool.call(effectiveInput, context)) {
      if (output.type === "progress") {
        context.onProgress?.(tool.name, block.id, output.content);
      } else {
        finalResult = output.content;
      }
    }
    const output = truncate(finalResult, tool.maxResultSizeChars);

    // ── PostToolUse hook ───────────────────────────────────────
    if (context.onPostToolUse) {
      await context.onPostToolUse(tool.name, effectiveInput, output, false).catch(() => {});
    }

    return {
      toolUseId: block.id,
      toolName: block.name,
      content: output,
      isError: false,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isInterrupt = context.abortSignal?.aborted ?? false;

    // ── PostToolUseFailure hook ─────────────────────────────────
    if (context.onPostToolUseFailure) {
      await context.onPostToolUseFailure(tool.name, block.input, message, isInterrupt).catch(() => {});
    }

    return {
      toolUseId: block.id,
      toolName: block.name,
      content: `Error: ${message}`,
      isError: true,
    };
  }
}
