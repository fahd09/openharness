/**
 * FileSelector — interactive file picker triggered by "@" in TextInput.
 *
 * Lists project files (via `git ls-files` or recursive readdir fallback),
 * supports type-to-filter with fuzzy matching, arrow key navigation,
 * Enter to select, Esc to cancel. Selected file path is returned to the caller.
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import { execSync } from "child_process";
import { readdirSync, statSync } from "fs";
import { join, relative } from "path";

const VIEWPORT_SIZE = 12;

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".cache",
  "coverage", "__pycache__", ".venv", "venv", ".tox",
]);

interface FileSelectorProps {
  cwd: string;
  onSelect: (filePath: string) => void;
  onCancel: () => void;
}

// ── File listing helpers ─────────────────────────────────────────

function listGitFiles(cwd: string): string[] {
  try {
    const output = execSync("git ls-files --cached --others --exclude-standard", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .filter((f) => f.length > 0)
      .sort();
  } catch {
    return [];
  }
}

function listFilesRecursive(dir: string, base: string, depth = 0): string[] {
  if (depth > 4) return [];
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && depth === 0 && entry.name !== ".env") continue;
      const relPath = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        results.push(...listFilesRecursive(join(dir, entry.name), relPath, depth + 1));
      } else {
        results.push(relPath);
      }
    }
  } catch {}
  return results;
}

function getFileList(cwd: string): string[] {
  const gitFiles = listGitFiles(cwd);
  if (gitFiles.length > 0) return gitFiles;
  return listFilesRecursive(cwd, "").sort();
}

// ── Fuzzy filter ─────────────────────────────────────────────────

function fuzzyMatch(query: string, target: string): boolean {
  const lower = target.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

// ── Component ────────────────────────────────────────────────────

export function FileSelector({ cwd, onSelect, onCancel }: FileSelectorProps): React.ReactElement {
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(true);

  // Load files on mount
  useEffect(() => {
    const files = getFileList(cwd);
    setAllFiles(files);
    setLoading(false);
  }, [cwd]);

  // Filter files by query
  const filtered = query
    ? allFiles.filter((f) => fuzzyMatch(query, f))
    : allFiles;

  // Clamp cursor when filtered list changes
  const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1));
  if (clampedCursor !== cursor && filtered.length > 0) {
    // Will be applied on next render via the setCursor in useInput
  }

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (filtered.length > 0) {
        const idx = Math.min(cursor, filtered.length - 1);
        onSelect(filtered[idx]);
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : Math.max(0, filtered.length - 1)));
      return;
    }

    if (key.downArrow) {
      setCursor((c) => (c < filtered.length - 1 ? c + 1 : 0));
      return;
    }

    // Backspace
    if (key.backspace || key.delete) {
      setQuery((q) => {
        const next = q.slice(0, -1);
        setCursor(0);
        return next;
      });
      return;
    }

    // Tab — auto-complete to common prefix
    if (key.tab) {
      if (filtered.length === 1) {
        onSelect(filtered[0]);
      }
      return;
    }

    // Regular character — append to query
    if (input && !key.ctrl && !key.meta && !key.leftArrow && !key.rightArrow) {
      setQuery((q) => {
        const next = q + input;
        setCursor(0);
        return next;
      });
    }
  });

  const cols = process.stdout.columns || 80;
  const separator = chalk.dim("\u2500".repeat(Math.max(cols - 1, 1)));

  if (loading) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>{separator}</Text>
        <Text>{chalk.dim("  Scanning files...")}</Text>
      </Box>
    );
  }

  // Viewport calculation
  const cur = Math.min(cursor, Math.max(0, filtered.length - 1));
  const half = Math.floor(VIEWPORT_SIZE / 2);
  let start = Math.max(0, cur - half);
  let end = start + VIEWPORT_SIZE;
  if (end > filtered.length) {
    end = filtered.length;
    start = Math.max(0, end - VIEWPORT_SIZE);
  }
  const visible = filtered.slice(start, end);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{separator}</Text>
      <Text>
        {chalk.bold("@ ")}{chalk.dim("File search")}
        {chalk.dim(` — ${filtered.length}/${allFiles.length} files`)}
      </Text>
      <Text>  {chalk.cyan("\u276F")} {query}{chalk.cyan("\u2588")}</Text>
      <Text>{""}</Text>

      {filtered.length === 0 ? (
        <Text>{chalk.dim("  No matching files.")}</Text>
      ) : (
        <>
          {start > 0 && <Text>{chalk.dim("  \u2191 more above")}</Text>}
          {visible.map((file, vi) => {
            const idx = start + vi;
            const isCurrent = idx === cur;
            if (isCurrent) {
              return (
                <Text key={file}>{"  "}{chalk.bgBlue.white(`\u276F ${file}`)}</Text>
              );
            }
            return (
              <Text key={file}>{"    "}{file}</Text>
            );
          })}
          {end < filtered.length && <Text>{chalk.dim("  \u2193 more below")}</Text>}
        </>
      )}

      <Text>{""}</Text>
      <Text>{chalk.dim("  Enter to select \u00B7 Tab to auto-complete \u00B7 Esc to cancel")}</Text>
      <Text>{separator}</Text>
    </Box>
  );
}
