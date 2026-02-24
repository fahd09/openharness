/**
 * Todo Bridge — maps TodoWrite tool operations to TaskItem state changes.
 */

import type { AppAction, TaskItem } from "../state.js";

interface PendingTodoOp {
  operation: string;
  content?: string;
  id?: string;
  status?: string;
}

export class TodoBridge {
  private pendingOps = new Map<string, PendingTodoOp>();

  /** Track a TodoWrite tool_use_start. */
  trackStart(toolUseId: string, input: Record<string, unknown>): void {
    this.pendingOps.set(toolUseId, {
      operation: String(input.operation ?? ""),
      content: input.content as string | undefined,
      id: input.id as string | undefined,
      status: input.status as string | undefined,
    });
  }

  /** Handle a TodoWrite tool_result, dispatching TASK_UPDATE actions. */
  handleResult(
    toolUseId: string,
    result: string,
    dispatch: (action: AppAction) => void,
  ): void {
    const op = this.pendingOps.get(toolUseId);
    this.pendingOps.delete(toolUseId);
    if (!op) return;

    switch (op.operation) {
      case "add": {
        const match = result.match(/^Added todo #(\d+): (.+)$/);
        if (match) {
          const task: TaskItem = {
            id: match[1],
            subject: match[2],
            status: "pending",
          };
          dispatch({ type: "TASK_UPDATE", task });
        }
        break;
      }

      case "update": {
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
          dispatch({ type: "TASK_UPDATE", task });
        }
        break;
      }

      case "delete": {
        const match = result.match(/^Deleted todo #(\d+)/);
        if (match) {
          const task: TaskItem = {
            id: match[1],
            subject: "(deleted)",
            status: "completed",
            completedAt: Date.now(),
          };
          dispatch({ type: "TASK_UPDATE", task });
        }
        break;
      }

      case "clear":
        break;
    }
  }

  clear(): void {
    this.pendingOps.clear();
  }
}
