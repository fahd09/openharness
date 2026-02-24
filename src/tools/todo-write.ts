/**
 * TodoWrite tool — manages a structured task list.
 *
 * The model uses this to track multi-step work. Each todo has:
 * - id, content, status (pending | in_progress | completed), priority
 *
 * Matches the original's TodoWrite with operations: add, update, delete, clear.
 */

import { z } from "zod";
import type { Tool, ToolContext } from "./tool-registry.js";

// ── Todo Storage ─────────────────────────────────────────────────────

interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
  priority?: "high" | "medium" | "low";
  createdAt: string;
}

// Session-scoped todo list (shared across the conversation)
const todoList: TodoItem[] = [];
let nextTodoId = 1;

/**
 * Get a snapshot of the current todo list (for /todos command).
 */
export function getTodoList(): Array<{ id: string; content: string; status: string; priority?: string; createdAt: string }> {
  return todoList.map((t) => ({ id: t.id, content: t.content, status: t.status, priority: t.priority, createdAt: t.createdAt }));
}

// ── Tool Schema ──────────────────────────────────────────────────────

const inputSchema = z.object({
  operation: z
    .enum(["add", "update", "delete", "clear", "list"])
    .describe("The operation to perform on the todo list"),
  content: z
    .string()
    .optional()
    .describe("Content/description of the todo item (for add operation)"),
  id: z
    .string()
    .optional()
    .describe("Todo ID (for update/delete operations)"),
  status: z
    .enum(["pending", "in_progress", "completed"])
    .optional()
    .describe("New status (for update operation)"),
  priority: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe("Priority level (for add/update operations)"),
});

export const todoWriteTool: Tool = {
  name: "TodoWrite",
  description:
    "Manage a structured task list. Use to track multi-step work with add/update/delete/clear/list operations.",
  inputSchema,
  maxResultSizeChars: 50000,
  isConcurrencySafe: () => false,
  isReadOnly: (input: unknown) => {
    const parsed = inputSchema.safeParse(input);
    return parsed.success && parsed.data.operation === "list";
  },

  async *call(rawInput: unknown, _context: ToolContext) {
    const input = inputSchema.parse(rawInput);

    switch (input.operation) {
      case "add": {
        if (!input.content) {
          yield { type: "result", content: "Error: content is required for add operation" };
          return;
        }
        const item: TodoItem = {
          id: String(nextTodoId++),
          content: input.content,
          status: "pending",
          priority: input.priority,
          createdAt: new Date().toISOString(),
        };
        todoList.push(item);
        yield { type: "result", content: `Added todo #${item.id}: ${item.content}` };
        return;
      }

      case "update": {
        if (!input.id) {
          yield { type: "result", content: "Error: id is required for update operation" };
          return;
        }
        const item = todoList.find((t) => t.id === input.id);
        if (!item) {
          yield { type: "result", content: `Error: Todo #${input.id} not found` };
          return;
        }
        if (input.status) item.status = input.status;
        if (input.content) item.content = input.content;
        if (input.priority) item.priority = input.priority;
        yield {
          type: "result",
          content: `Updated todo #${item.id}: [${item.status}] ${item.content}`,
        };
        return;
      }

      case "delete": {
        if (!input.id) {
          yield { type: "result", content: "Error: id is required for delete operation" };
          return;
        }
        const idx = todoList.findIndex((t) => t.id === input.id);
        if (idx === -1) {
          yield { type: "result", content: `Error: Todo #${input.id} not found` };
          return;
        }
        const removed = todoList.splice(idx, 1)[0];
        yield { type: "result", content: `Deleted todo #${removed.id}: ${removed.content}` };
        return;
      }

      case "clear": {
        const count = todoList.length;
        todoList.length = 0;
        yield { type: "result", content: `Cleared ${count} todo items` };
        return;
      }

      case "list": {
        if (todoList.length === 0) {
          yield { type: "result", content: "No todos." };
          return;
        }
        const lines = todoList.map((t) => {
          const statusIcon =
            t.status === "completed" ? "✓" :
            t.status === "in_progress" ? "→" : "○";
          const priority = t.priority ? ` [${t.priority}]` : "";
          return `${statusIcon} #${t.id}${priority}: ${t.content} (${t.status})`;
        });
        yield { type: "result", content: lines.join("\n") };
        return;
      }

      default:
        yield { type: "result", content: `Error: Unknown operation "${input.operation}"` };
    }
  },
};
