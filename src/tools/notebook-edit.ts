/**
 * NotebookEdit Tool — cell-level .ipynb editing.
 *
 * Supports replace, insert, and delete operations on Jupyter notebook cells.
 */

import { z } from "zod";
import { readFile, writeFile } from "fs/promises";
import type { Tool, ToolOutput, ToolContext } from "./tool-registry.js";

interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string[];
  metadata: Record<string, unknown>;
  outputs?: unknown[];
  execution_count?: number | null;
  id?: string;
}

interface Notebook {
  nbformat: number;
  nbformat_minor: number;
  metadata: Record<string, unknown>;
  cells: NotebookCell[];
}

export const notebookEditTool: Tool = {
  name: "NotebookEdit",
  description:
    "Edit Jupyter notebook cells. Supports replace, insert, and delete operations. " +
    "The notebook_path must be an absolute path. Cell numbers are 0-indexed.",
  inputSchema: z.object({
    notebook_path: z
      .string()
      .describe("Absolute path to the .ipynb file"),
    cell_number: z
      .number()
      .optional()
      .describe("0-indexed cell number to operate on"),
    new_source: z
      .string()
      .describe("New source content for the cell"),
    cell_type: z
      .enum(["code", "markdown"])
      .optional()
      .describe("Cell type (required for insert)"),
    edit_mode: z
      .enum(["replace", "insert", "delete"])
      .optional()
      .describe("Operation: replace (default), insert, or delete"),
  }),
  maxResultSizeChars: 10_000,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    input: unknown,
    context: ToolContext
  ): AsyncGenerator<ToolOutput> {
    const {
      notebook_path,
      cell_number,
      new_source,
      cell_type,
      edit_mode = "replace",
    } = input as {
      notebook_path: string;
      cell_number?: number;
      new_source: string;
      cell_type?: "code" | "markdown";
      edit_mode?: "replace" | "insert" | "delete";
    };

    // Read the notebook
    let notebook: Notebook;
    try {
      const content = await readFile(notebook_path, "utf-8");
      notebook = JSON.parse(content) as Notebook;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "result", content: `Error reading notebook: ${msg}` };
      return;
    }

    if (!notebook.cells || !Array.isArray(notebook.cells)) {
      yield { type: "result", content: "Error: Invalid notebook format — no cells array" };
      return;
    }

    const sourceLines = new_source.split("\n").map((line, i, arr) =>
      i < arr.length - 1 ? line + "\n" : line
    );

    switch (edit_mode) {
      case "replace": {
        const idx = cell_number ?? 0;
        if (idx < 0 || idx >= notebook.cells.length) {
          yield {
            type: "result",
            content: `Error: Cell ${idx} out of range (notebook has ${notebook.cells.length} cells)`,
          };
          return;
        }
        notebook.cells[idx].source = sourceLines;
        if (cell_type) {
          notebook.cells[idx].cell_type = cell_type;
        }
        // Clear outputs for code cells
        if (notebook.cells[idx].cell_type === "code") {
          notebook.cells[idx].outputs = [];
          notebook.cells[idx].execution_count = null;
        }
        yield {
          type: "result",
          content: `Replaced cell ${idx} (${notebook.cells[idx].cell_type})`,
        };
        break;
      }

      case "insert": {
        const insertIdx = cell_number !== undefined ? cell_number : notebook.cells.length;
        const newCell: NotebookCell = {
          cell_type: cell_type ?? "code",
          source: sourceLines,
          metadata: {},
          ...(cell_type !== "markdown" ? { outputs: [], execution_count: null } : {}),
        };
        notebook.cells.splice(insertIdx, 0, newCell);
        yield {
          type: "result",
          content: `Inserted ${newCell.cell_type} cell at position ${insertIdx}`,
        };
        break;
      }

      case "delete": {
        const delIdx = cell_number ?? 0;
        if (delIdx < 0 || delIdx >= notebook.cells.length) {
          yield {
            type: "result",
            content: `Error: Cell ${delIdx} out of range (notebook has ${notebook.cells.length} cells)`,
          };
          return;
        }
        const deleted = notebook.cells.splice(delIdx, 1)[0];
        yield {
          type: "result",
          content: `Deleted cell ${delIdx} (${deleted.cell_type})`,
        };
        break;
      }
    }

    // Write back
    try {
      await writeFile(notebook_path, JSON.stringify(notebook, null, 1) + "\n", "utf-8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: "result", content: `Error writing notebook: ${msg}` };
    }
  },
};
