/**
 * Session Persistence — save and restore conversation transcripts.
 *
 * Sessions are stored as JSON files in ~/.openharness/sessions/.
 * Each session includes: messages, model, timestamp, metadata.
 *
 * Also supports read-only import of Claude Code sessions from
 * ~/.claude/projects/{dirName}/ (JSONL format).
 *
 * Supports:
 * - Auto-save after each interaction
 * - Resume with --resume <session-id>
 * - List sessions with /sessions command
 */

import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { ConversationMessage } from "./types.js";
import {
  getClaudeProjectDir,
  parseJsonlFile,
  CLAUDE_PROJECT_DIR,
} from "./claude-compat.js";

const SESSION_DIR = join(homedir(), ".openharness", "sessions");

export interface SessionMetadata {
  id: string;
  model: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** First user message (truncated) — used as session title */
  title: string;
  /** Custom user-defined title (overrides derived title). */
  customTitle?: string;
  /** User-defined tags for organization. */
  tags?: string[];
  /** Source of the session: "native" or "claude-code". */
  source?: "native" | "claude-code";
}

export interface Session {
  metadata: SessionMetadata;
  messages: ConversationMessage[];
}

/**
 * Ensure the sessions directory exists.
 */
async function ensureSessionDir(): Promise<void> {
  await mkdir(SESSION_DIR, { recursive: true });
}

/**
 * Generate a new session ID.
 */
export function newSessionId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * Derive a session title from the first user message.
 */
function deriveTitle(messages: ConversationMessage[]): string {
  const first = messages.find((m) => m.type === "user");
  if (!first || typeof first.content !== "string") return "(untitled)";
  const text = first.content.trim();
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

/**
 * Save a session to disk.
 */
export async function saveSession(
  sessionId: string,
  messages: ConversationMessage[],
  model: string,
  cwd: string
): Promise<void> {
  await ensureSessionDir();

  const filePath = join(SESSION_DIR, `${sessionId}.json`);

  // Try to load existing metadata for createdAt
  let createdAt: string;
  try {
    const existing = JSON.parse(await readFile(filePath, "utf-8")) as Session;
    createdAt = existing.metadata.createdAt;
  } catch {
    createdAt = new Date().toISOString();
  }

  const session: Session = {
    metadata: {
      id: sessionId,
      model,
      cwd,
      createdAt,
      updatedAt: new Date().toISOString(),
      messageCount: messages.length,
      title: deriveTitle(messages),
      source: "native",
    },
    messages,
  };

  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * Load a session from disk.
 *
 * Checks native sessions first, then tries Claude Code sessions
 * if a cwd is provided or can be inferred.
 */
export async function loadSession(
  sessionId: string,
  cwd?: string
): Promise<Session | null> {
  // 1. Try native session
  try {
    const filePath = join(SESSION_DIR, `${sessionId}.json`);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as Session;
  } catch {
    // Not found — try Claude Code
  }

  // 2. Try Claude Code session (search all project dirs if no cwd specified)
  return loadClaudeCodeSession(sessionId, cwd);
}

/**
 * Rename a session with a custom title.
 */
export async function renameSession(sessionId: string, name: string): Promise<void> {
  const session = await loadSession(sessionId);
  if (!session) return;
  session.metadata.customTitle = name;
  const filePath = join(SESSION_DIR, `${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * Add a tag to a session.
 */
export async function tagSession(sessionId: string, tag: string): Promise<void> {
  const session = await loadSession(sessionId);
  if (!session) return;
  const tags = session.metadata.tags ?? [];
  if (!tags.includes(tag)) {
    tags.push(tag);
  }
  session.metadata.tags = tags;
  const filePath = join(SESSION_DIR, `${sessionId}.json`);
  await writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
}

/**
 * List all saved sessions (most recent first).
 *
 * Merges native sessions with Claude Code sessions for the given cwd.
 */
export async function listSessions(cwd?: string): Promise<SessionMetadata[]> {
  await ensureSessionDir();

  const files = await readdir(SESSION_DIR);
  const sessions: SessionMetadata[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const content = await readFile(join(SESSION_DIR, file), "utf-8");
      const session = JSON.parse(content) as Session;
      session.metadata.source ??= "native";
      sessions.push(session.metadata);
    } catch {
      // Skip corrupt files
    }
  }

  // Merge Claude Code sessions if cwd is available
  if (cwd) {
    try {
      const ccSessions = await listClaudeCodeSessions(cwd);
      // Only add Claude Code sessions that don't collide with native IDs
      const nativeIds = new Set(sessions.map((s) => s.id));
      for (const s of ccSessions) {
        if (!nativeIds.has(s.id)) {
          sessions.push(s);
        }
      }
    } catch {
      // Ignore errors from Claude Code session discovery
    }
  }

  // Sort by updatedAt descending
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return sessions;
}

/**
 * Search sessions by query string (matches title, tags, cwd).
 */
export async function searchSessions(query: string, cwd?: string): Promise<SessionMetadata[]> {
  const all = await listSessions(cwd);
  const lowerQuery = query.toLowerCase();

  return all.filter((s) => {
    const title = (s.customTitle ?? s.title).toLowerCase();
    const sessionCwd = s.cwd.toLowerCase();
    const tags = (s.tags ?? []).join(" ").toLowerCase();
    const id = s.id.toLowerCase();

    return (
      title.includes(lowerQuery) ||
      sessionCwd.includes(lowerQuery) ||
      tags.includes(lowerQuery) ||
      id.includes(lowerQuery)
    );
  });
}

/**
 * Delete a session from disk.
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const { unlink } = await import("fs/promises");
    await unlink(join(SESSION_DIR, `${sessionId}.json`));
    return true;
  } catch {
    return false;
  }
}

// ── Claude Code Session Import ──────────────────────────────────────

/**
 * List Claude Code sessions for a given cwd.
 *
 * Checks the sessions-index.json first. If not available,
 * falls back to scanning for .jsonl files.
 */
async function listClaudeCodeSessions(cwd: string): Promise<SessionMetadata[]> {
  const projectDir = getClaudeProjectDir(cwd);
  const sessions: SessionMetadata[] = [];

  // Try sessions-index.json first
  try {
    const indexPath = join(projectDir, "sessions-index.json");
    const content = await readFile(indexPath, "utf-8");
    const index = JSON.parse(content) as {
      entries?: Array<{
        sessionId: string;
        summary?: string;
        firstPrompt?: string;
        messageCount?: number;
        created?: string;
        modified?: string;
        projectPath?: string;
      }>;
    };

    if (Array.isArray(index.entries)) {
      for (const entry of index.entries) {
        const title = entry.summary || entry.firstPrompt || "(untitled)";
        sessions.push({
          id: entry.sessionId,
          model: "claude",
          cwd: entry.projectPath ?? cwd,
          createdAt: entry.created ?? "",
          updatedAt: entry.modified ?? entry.created ?? "",
          messageCount: entry.messageCount ?? 0,
          title: title.length > 80 ? title.slice(0, 77) + "..." : title,
          source: "claude-code",
        });
      }
      return sessions;
    }
  } catch {
    // No index — fall through to directory scan
  }

  // Fallback: scan for .jsonl files
  try {
    const files = await readdir(projectDir);
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = file.replace(/\.jsonl$/, "");
      try {
        const filePath = join(projectDir, file);
        const fileStat = await stat(filePath);

        // Scan events to derive title and count messages
        let title = "(untitled)";
        let messageCount = 0;
        for await (const event of parseJsonlFile(filePath)) {
          if (event.type === "user" || event.type === "assistant") {
            messageCount++;
            if (title === "(untitled)" && event.type === "user") {
              const msg = event.message as Record<string, unknown> | undefined;
              const content = msg?.content;
              if (typeof content === "string") {
                title = content.trim();
                if (title.length > 80) title = title.slice(0, 77) + "...";
              }
            }
          }
        }

        sessions.push({
          id: sessionId,
          model: "claude",
          cwd,
          createdAt: fileStat.birthtime.toISOString(),
          updatedAt: fileStat.mtime.toISOString(),
          messageCount,
          title,
          source: "claude-code",
        });
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Project dir doesn't exist
  }

  return sessions;
}

/**
 * Load a Claude Code session from a JSONL file.
 *
 * Streams the file, collecting user and assistant events,
 * and converts them to our ConversationMessage format.
 */
async function loadClaudeCodeSession(
  sessionId: string,
  cwd?: string
): Promise<Session | null> {
  // Find the JSONL file — either in the specified project dir or by scanning
  const projectDirs: string[] = [];

  if (cwd) {
    projectDirs.push(getClaudeProjectDir(cwd));
  }

  // Also scan all project dirs if not found in specified cwd
  try {
    const allDirs = await readdir(CLAUDE_PROJECT_DIR);
    for (const dir of allDirs) {
      const fullDir = join(CLAUDE_PROJECT_DIR, dir);
      if (!projectDirs.includes(fullDir)) {
        projectDirs.push(fullDir);
      }
    }
  } catch {
    // ~/.claude/projects doesn't exist
  }

  for (const projectDir of projectDirs) {
    const jsonlPath = join(projectDir, `${sessionId}.jsonl`);
    try {
      await stat(jsonlPath);
    } catch {
      continue; // File doesn't exist in this dir
    }

    // Parse the JSONL file
    const messages: ConversationMessage[] = [];
    let firstTimestamp = "";
    let lastTimestamp = "";
    let sessionCwd = cwd ?? "";
    let model = "claude";

    for await (const event of parseJsonlFile(jsonlPath)) {
      const eventType = event.type as string;
      const timestamp = (event.timestamp as string) ?? "";
      const uuid = (event.uuid as string) ?? randomUUID();

      if (!firstTimestamp && timestamp) firstTimestamp = timestamp;
      if (timestamp) lastTimestamp = timestamp;

      // Extract cwd from event if available
      if (event.cwd && !sessionCwd) {
        sessionCwd = event.cwd as string;
      }

      if (eventType === "user") {
        const msg = event.message as Record<string, unknown> | undefined;
        if (!msg) continue;
        const content = msg.content;
        if (typeof content === "string") {
          messages.push({
            type: "user",
            role: "user",
            content,
            uuid,
            timestamp,
          });
        } else if (Array.isArray(content)) {
          // Tool result content blocks — store as-is
          messages.push({
            type: "user",
            role: "user",
            content: content as any,
            uuid,
            timestamp,
          });
        }
      } else if (eventType === "assistant") {
        const msg = event.message as Record<string, unknown> | undefined;
        if (!msg) continue;
        const content = msg.content;
        if (!Array.isArray(content)) continue;

        model = (msg.model as string) ?? model;

        messages.push({
          type: "assistant",
          role: "assistant",
          content: content as any,
          model: (msg.model as string) ?? "claude",
          stop_reason: (msg.stop_reason as any) ?? "end_turn",
          usage: (msg.usage as any) ?? {
            input_tokens: 0,
            output_tokens: 0,
          },
          uuid,
          timestamp,
        });
      }
      // Skip: file-history-snapshot, queue-operation, progress, system
    }

    if (messages.length === 0) return null;

    return {
      metadata: {
        id: sessionId,
        model,
        cwd: sessionCwd,
        createdAt: firstTimestamp,
        updatedAt: lastTimestamp,
        messageCount: messages.length,
        title: deriveTitle(messages),
        source: "claude-code",
      },
      messages,
    };
  }

  return null;
}
