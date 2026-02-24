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
  /** Index: path → sorted list of indices into snapshots[]. O(1) path lookup. */
  private pathIndex = new Map<string, number[]>();

  /** Save a snapshot of a file before it gets modified. */
  saveSnapshot(path: string, content: string): void {
    const idx = this.snapshots.length;
    this.snapshots.push({
      path,
      content,
      timestamp: new Date().toISOString(),
    });
    let indices = this.pathIndex.get(path);
    if (!indices) {
      indices = [];
      this.pathIndex.set(path, indices);
    }
    indices.push(idx);
  }

  /** Get the last snapshot for a specific file, or the most recent of any file. */
  getLastSnapshot(path?: string): FileSnapshot | null {
    if (path) {
      const indices = this.pathIndex.get(path);
      if (!indices || indices.length === 0) return null;
      return this.snapshots[indices[indices.length - 1]];
    }
    return this.snapshots.length > 0
      ? this.snapshots[this.snapshots.length - 1]
      : null;
  }

  /** Remove the last snapshot for a file (after undoing). */
  removeLastSnapshot(path: string): void {
    const indices = this.pathIndex.get(path);
    if (!indices || indices.length === 0) return;
    const idx = indices.pop()!;
    this.snapshots.splice(idx, 1);
    // Rebuild index — splice shifts subsequent indices
    this.rebuildIndex();
  }

  /** Get all snapshots. */
  getAll(): FileSnapshot[] {
    return [...this.snapshots];
  }

  /** Clear all snapshots. */
  clear(): void {
    this.snapshots.length = 0;
    this.pathIndex.clear();
  }

  private rebuildIndex(): void {
    this.pathIndex.clear();
    for (let i = 0; i < this.snapshots.length; i++) {
      const p = this.snapshots[i].path;
      let indices = this.pathIndex.get(p);
      if (!indices) {
        indices = [];
        this.pathIndex.set(p, indices);
      }
      indices.push(i);
    }
  }
}

// Singleton instance
const fileHistory = new FileHistory();

export function getFileHistory(): FileHistory {
  return fileHistory;
}
