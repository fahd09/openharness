import { structuredPatch } from "diff";
import chalk from "chalk";

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

const CONTEXT_LINES = 3;

export function computePatch(
  filePath: string,
  oldContent: string,
  newContent: string
): Hunk[] {
  return structuredPatch(filePath, filePath, oldContent, newContent, "", "", {
    context: CONTEXT_LINES,
  }).hunks;
}

export function formatDiff(hunks: Hunk[], termWidth?: number): string {
  const width = termWidth || process.stdout.columns || 80;
  const lines: string[] = [];

  for (const hunk of hunks) {
    lines.push(
      chalk.cyan(
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
      )
    );

    let oldLineNum = hunk.oldStart;
    let newLineNum = hunk.newStart;

    for (const line of hunk.lines) {
      const maxContentWidth = width - 10;
      const content = line.slice(1);
      const truncated =
        content.length > maxContentWidth
          ? content.slice(0, maxContentWidth - 3) + "..."
          : content;

      if (line.startsWith("+")) {
        const num = String(newLineNum++).padStart(4);
        lines.push(chalk.green(`${num}  + ${truncated}`));
      } else if (line.startsWith("-")) {
        const num = String(oldLineNum++).padStart(4);
        lines.push(chalk.red(`${num}  - ${truncated}`));
      } else {
        const num = String(oldLineNum++).padStart(4);
        newLineNum++;
        lines.push(chalk.dim(`${num}    ${truncated}`));
      }
    }
  }
  return lines.join("\n");
}

export function formatDiffSummary(hunks: Hunk[]): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith("+")) added++;
      else if (line.startsWith("-")) removed++;
    }
  }
  return { added, removed };
}
