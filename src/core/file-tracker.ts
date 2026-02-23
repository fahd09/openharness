/**
 * File Change Tracker — tracks file operations during a session.
 *
 * Records which files were created, modified, or deleted,
 * along with lines added/removed. Integrates via PostToolUse hook.
 */

export interface FileChange {
  path: string;
  operation: "create" | "edit" | "delete";
  linesAdded: number;
  linesRemoved: number;
  timestamp: string;
}

export class FileChangeTracker {
  private changes: FileChange[] = [];

  /** Record a file operation. */
  record(change: FileChange): void {
    this.changes.push(change);
  }

  /** Record from a Write tool result. */
  recordWrite(filePath: string, content: string, isNew: boolean): void {
    this.changes.push({
      path: filePath,
      operation: isNew ? "create" : "edit",
      linesAdded: content.split("\n").length,
      linesRemoved: 0,
      timestamp: new Date().toISOString(),
    });
  }

  /** Record from an Edit tool result. */
  recordEdit(filePath: string, oldStr: string, newStr: string): void {
    const oldLines = oldStr.split("\n").length;
    const newLines = newStr.split("\n").length;
    this.changes.push({
      path: filePath,
      operation: "edit",
      linesAdded: Math.max(0, newLines - oldLines),
      linesRemoved: Math.max(0, oldLines - newLines),
      timestamp: new Date().toISOString(),
    });
  }

  /** Get all changes. */
  getChanges(): FileChange[] {
    return [...this.changes];
  }

  /** Get unique files changed. */
  getChangedFiles(): string[] {
    return [...new Set(this.changes.map((c) => c.path))];
  }

  /** Get summary statistics. */
  getSummary(): { filesChanged: number; totalAdded: number; totalRemoved: number } {
    const files = new Set(this.changes.map((c) => c.path));
    let totalAdded = 0;
    let totalRemoved = 0;
    for (const c of this.changes) {
      totalAdded += c.linesAdded;
      totalRemoved += c.linesRemoved;
    }
    return {
      filesChanged: files.size,
      totalAdded,
      totalRemoved,
    };
  }

  /** Clear all tracked changes. */
  clear(): void {
    this.changes.length = 0;
  }
}
