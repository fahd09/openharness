/**
 * File History — pre-edit snapshots for undo support.
 *
 * Records file contents before Write/Edit operations via PreToolUse hook.
 * Enables /undo to revert the last change to a file.
 */

export interface FileSnapshot {
  path: string;
  content: string;
  timestamp: string;
}

class FileHistory {
  private snapshots: FileSnapshot[] = [];

  /** Save a snapshot of a file before it gets modified. */
  saveSnapshot(path: string, content: string): void {
    this.snapshots.push({
      path,
      content,
      timestamp: new Date().toISOString(),
    });
  }

  /** Get the last snapshot for a specific file, or the most recent of any file. */
  getLastSnapshot(path?: string): FileSnapshot | null {
    if (path) {
      for (let i = this.snapshots.length - 1; i >= 0; i--) {
        if (this.snapshots[i].path === path) return this.snapshots[i];
      }
      return null;
    }
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : null;
  }

  /** Remove the last snapshot for a file (after undoing). */
  removeLastSnapshot(path: string): void {
    for (let i = this.snapshots.length - 1; i >= 0; i--) {
      if (this.snapshots[i].path === path) {
        this.snapshots.splice(i, 1);
        return;
      }
    }
  }

  /** Get all snapshots. */
  getAll(): FileSnapshot[] {
    return [...this.snapshots];
  }

  /** Clear all snapshots. */
  clear(): void {
    this.snapshots.length = 0;
  }
}

// Singleton instance
const fileHistory = new FileHistory();

export function getFileHistory(): FileHistory {
  return fileHistory;
}
