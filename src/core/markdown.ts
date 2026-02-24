/**
 * Terminal Markdown Renderer — converts markdown to chalk-formatted text.
 *
 * Handles:
 * - Headers (#, ##, ###) → bold, with underline for h1
 * - Bold (**text**) → chalk.bold
 * - Italic (*text*) → chalk.italic
 * - Inline code (`code`) → chalk.cyan
 * - Code blocks (``` ... ```) → syntax highlighted with language support
 * - Tables (| col | col |) → aligned columns with borders
 * - Unordered lists (- item) → bullet points
 * - Ordered lists (1. item) → numbered
 * - Links [text](url) → clickable hyperlinks (OSC 8)
 * - Horizontal rules (---) → dim line
 * - Blockquotes (> text) → dim, indented
 */

import chalk from "chalk";
import { highlightLine } from "./syntax-highlight.js";

// ── Clickable hyperlinks (OSC 8) ──────────────────────────────────

/**
 * Create a clickable hyperlink using the OSC 8 escape sequence.
 * Falls back to plain text + URL on terminals that don't support it.
 */
function hyperlink(text: string, url: string): string {
  // Ink's <Text> doesn't handle OSC 8 — use plain formatted text.
  // Explicit reset (\x1b[0m) after each styled segment prevents color bleed
  // when Ink's text wrapping splits lines mid-ANSI-sequence.
  return `${chalk.blue(text)}\x1b[0m${chalk.dim(` (${url})`)}\x1b[0m`;
}

// ── Table rendering ────────────────────────────────────────────────

/**
 * Parse a markdown table (lines starting with |).
 * Returns null if the lines don't form a valid table.
 */
function parseTable(lines: string[]): string[][] | null {
  if (lines.length < 2) return null;

  const rows: string[][] = [];
  for (const line of lines) {
    // Skip separator rows (| --- | --- |)
    if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;

    const cells = line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());

    if (cells.length > 0) rows.push(cells);
  }

  return rows.length >= 1 ? rows : null;
}

/**
 * Render a parsed table with proper column alignment.
 */
function renderTable(rows: string[][]): string[] {
  if (rows.length === 0) return [];

  const colCount = Math.max(...rows.map((r) => r.length));

  // Format all cells first, then calculate widths from visual output
  const formattedRows = rows.map((row, r) => {
    const formatted: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? "";
      formatted.push(r === 0 ? chalk.bold(formatInline(cell)) : formatInline(cell));
    }
    return formatted;
  });

  // Calculate column widths from formatted (visual) content
  const colWidths: number[] = new Array(colCount).fill(0);
  for (const row of formattedRows) {
    for (let c = 0; c < row.length; c++) {
      colWidths[c] = Math.max(colWidths[c], stripAnsi(row[c]).length);
    }
  }

  // Cap column widths to terminal width
  const termWidth = process.stdout.columns || 80;
  const maxColWidth = Math.floor((termWidth - colCount * 3 - 4) / colCount);
  for (let c = 0; c < colWidths.length; c++) {
    colWidths[c] = Math.min(colWidths[c], Math.max(maxColWidth, 10));
  }

  const output: string[] = [];

  // Top border
  const topBorder = "  ┌" + colWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  output.push(chalk.dim(topBorder));

  for (let r = 0; r < formattedRows.length; r++) {
    const row = formattedRows[r];
    let line = chalk.dim("  │");
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? "";
      const visualWidth = stripAnsi(cell).length;
      const padding = colWidths[c] - visualWidth;
      line += " " + cell + " ".repeat(Math.max(padding, 0)) + " " + chalk.dim("│");
    }
    output.push(line);

    // Separator after header
    if (r === 0) {
      const sep = "  ├" + colWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
      output.push(chalk.dim(sep));
    }
  }

  // Bottom border
  const bottomBorder = "  └" + colWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";
  output.push(chalk.dim(bottomBorder));

  return output;
}

/**
 * Strip ANSI escape codes from a string for length calculation.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")   // CSI sequences (colors, bold, etc.)
    .replace(/\x1b\]8;;[^\x1b]*\x1b\\/g, ""); // OSC 8 hyperlinks
}

// ── Main renderer ─────────────────────────────────────────────────

/**
 * Render a markdown string to terminal-formatted text using chalk.
 */
export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = "";

  // Table accumulator
  let tableLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if we're accumulating table rows
    if (!inCodeBlock && line.trim().startsWith("|") && line.trim().endsWith("|")) {
      tableLines.push(line);
      continue;
    } else if (tableLines.length > 0) {
      // End of table — render accumulated rows
      const rows = parseTable(tableLines);
      if (rows) {
        output.push(...renderTable(rows));
      } else {
        // Not a valid table — render as regular lines
        for (const tl of tableLines) output.push(formatInline(tl));
      }
      tableLines = [];
    }

    // Code block boundaries
    if (line.trimStart().startsWith("```")) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        codeBlockLang = line.trimStart().slice(3).trim();
        const label = codeBlockLang ? chalk.dim(` ${codeBlockLang}`) : "";
        output.push(chalk.dim("  ┌──") + label);
      } else {
        inCodeBlock = false;
        codeBlockLang = "";
        output.push(chalk.dim("  └──"));
      }
      continue;
    }

    // Inside code block — render with syntax highlighting
    if (inCodeBlock) {
      const highlighted = codeBlockLang
        ? highlightLine(line, codeBlockLang)
        : chalk.gray(line);
      output.push(chalk.gray("  │ ") + highlighted);
      continue;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      const width = Math.min(process.stdout.columns || 80, 80);
      output.push(chalk.dim("─".repeat(width)));
      continue;
    }

    // Headers
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) {
      output.push(chalk.bold(formatInline(h3Match[1])));
      continue;
    }
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) {
      output.push(chalk.bold(formatInline(h2Match[1])));
      continue;
    }
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) {
      output.push(chalk.bold.underline(formatInline(h1Match[1])));
      continue;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      output.push(chalk.dim("  │ " + formatInline(line.slice(2))));
      continue;
    }

    // Unordered list items
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      const indent = ulMatch[1];
      output.push(indent + "  " + chalk.dim("•") + " " + formatInline(ulMatch[2]));
      continue;
    }

    // Ordered list items
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      const indent = olMatch[1];
      output.push(indent + "  " + chalk.dim(olMatch[2] + ".") + " " + formatInline(olMatch[3]));
      continue;
    }

    // Regular line — apply inline formatting
    output.push(formatInline(line));
  }

  // Flush any remaining table
  if (tableLines.length > 0) {
    const rows = parseTable(tableLines);
    if (rows) {
      output.push(...renderTable(rows));
    } else {
      for (const tl of tableLines) output.push(formatInline(tl));
    }
  }

  // Close unclosed code block
  if (inCodeBlock) {
    output.push(chalk.dim("  └──"));
  }

  return output.join("\n");
}

/**
 * Apply inline markdown formatting to a line of text.
 */
export function formatInline(text: string): string {
  // Use placeholders for elements that produce ANSI/OSC codes containing
  // brackets and special chars — prevents bold/italic regex from breaking them.
  const placeholders: string[] = [];
  const ph = (s: string) => {
    const idx = placeholders.length;
    placeholders.push(s);
    return `\x00PH${idx}\x00`;
  };

  // 1. Inline code — protect from all further processing
  text = text.replace(/`([^`]+?)`/g, (_, content) => ph(chalk.cyan(content)));

  // 2. Links — convert before bold/italic can capture brackets
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, linkText, url) =>
    ph(hyperlink(linkText, url))
  );

  // 3. Bold: **text** or __text__
  text = text.replace(/\*\*(.+?)\*\*/g, (_, content) => chalk.bold(content));
  text = text.replace(/__(.+?)__/g, (_, content) => chalk.bold(content));

  // 4. Italic: *text* or _text_ (but not inside bold markers)
  text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, (_, content) => chalk.italic(content));
  text = text.replace(/(?<!_)_([^_]+?)_(?!_)/g, (_, content) => chalk.italic(content));

  // 5. Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, (_, content) => chalk.strikethrough(content));

  // Re-insert placeholders
  text = text.replace(/\x00PH(\d+)\x00/g, (_, idx) => placeholders[parseInt(idx)]);

  return text;
}

/**
 * Line-buffered streaming markdown renderer.
 *
 * Buffers incoming text deltas until complete lines are available,
 * then renders each line with full markdown formatting (headers, bold,
 * italic, code blocks, lists, etc.) before outputting.
 *
 * Usage:
 *   const renderer = new StreamingRenderer(process.stdout.write.bind(process.stdout));
 *   // In onTextDelta callback:
 *   renderer.push(deltaText);
 *   // After stream ends:
 *   renderer.flush();
 */
export class StreamingRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeBlockLang = "";
  private tableLines: string[] = [];
  private writer: (text: string) => void;

  constructor(writer: (text: string) => void) {
    this.writer = writer;
  }

  /** Feed a text delta into the renderer. Complete lines are rendered immediately. */
  push(text: string): void {
    this.buffer += text;

    // Process all complete lines
    let idx = this.buffer.indexOf("\n");
    while (idx !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.processLine(line);
      idx = this.buffer.indexOf("\n");
    }
  }

  /** Flush any remaining buffered text (incomplete last line). */
  flush(): void {
    // Flush table if in progress
    this.flushTable();

    if (this.buffer) {
      this.writer(this.renderLine(this.buffer));
      this.buffer = "";
    }
    // Reset code block state for next response
    if (this.inCodeBlock) {
      this.writer("\n" + chalk.dim("  └──"));
      this.inCodeBlock = false;
      this.codeBlockLang = "";
    }
  }

  private processLine(line: string): void {
    // Check if we're accumulating table rows
    if (!this.inCodeBlock && line.trim().startsWith("|") && line.trim().endsWith("|")) {
      this.tableLines.push(line);
      return;
    } else if (this.tableLines.length > 0) {
      this.flushTable();
    }

    this.writer(this.renderLine(line) + "\n");
  }

  private flushTable(): void {
    if (this.tableLines.length === 0) return;

    const rows = parseTable(this.tableLines);
    if (rows) {
      const rendered = renderTable(rows);
      for (const line of rendered) {
        this.writer(line + "\n");
      }
    } else {
      for (const tl of this.tableLines) {
        this.writer(formatInline(tl) + "\n");
      }
    }
    this.tableLines = [];
  }

  private renderLine(line: string): string {
    // Code block boundaries
    if (line.trimStart().startsWith("```")) {
      if (!this.inCodeBlock) {
        this.inCodeBlock = true;
        this.codeBlockLang = line.trimStart().slice(3).trim();
        const label = this.codeBlockLang ? chalk.dim(` ${this.codeBlockLang}`) : "";
        return chalk.dim("  ┌──") + label;
      } else {
        this.inCodeBlock = false;
        this.codeBlockLang = "";
        return chalk.dim("  └──");
      }
    }

    // Inside code block — syntax highlighted
    if (this.inCodeBlock) {
      const highlighted = this.codeBlockLang
        ? highlightLine(line, this.codeBlockLang)
        : chalk.gray(line);
      return chalk.gray("  │ ") + highlighted;
    }

    // Horizontal rule
    if (/^-{3,}$/.test(line.trim()) || /^\*{3,}$/.test(line.trim())) {
      const width = Math.min(process.stdout.columns || 80, 80);
      return chalk.dim("─".repeat(width));
    }

    // Headers
    const h3Match = line.match(/^###\s+(.+)/);
    if (h3Match) return chalk.bold(formatInline(h3Match[1]));
    const h2Match = line.match(/^##\s+(.+)/);
    if (h2Match) return chalk.bold(formatInline(h2Match[1]));
    const h1Match = line.match(/^#\s+(.+)/);
    if (h1Match) return chalk.bold.underline(formatInline(h1Match[1]));

    // Blockquotes
    if (line.startsWith("> ")) {
      return chalk.dim("  │ " + formatInline(line.slice(2)));
    }

    // Unordered list items
    const ulMatch = line.match(/^(\s*)[-*]\s+(.+)/);
    if (ulMatch) {
      return ulMatch[1] + "  " + chalk.dim("•") + " " + formatInline(ulMatch[2]);
    }

    // Ordered list items
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      return olMatch[1] + "  " + chalk.dim(olMatch[2] + ".") + " " + formatInline(olMatch[3]);
    }

    // Regular line
    return formatInline(line);
  }
}
