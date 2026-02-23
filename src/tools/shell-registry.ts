/**
 * Shell Registry — manages background shell processes.
 *
 * When Bash is called with run_in_background=true, the shell process
 * is registered here. BashOutput reads from it, KillShell terminates it.
 */

import { spawn, type ChildProcess } from "child_process";

export interface ShellEntry {
  id: string;
  process: ChildProcess;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  startedAt: string;
  finished: boolean;
}

const shells = new Map<string, ShellEntry>();

let nextId = 1;

/**
 * Spawn a background shell and register it.
 * Returns the shell ID immediately.
 */
export function spawnBackgroundShell(
  command: string,
  cwd: string,
  timeout: number = 600000
): ShellEntry {
  const id = String(nextId++);

  const child = spawn("/bin/bash", ["-c", command], {
    cwd,
    env: { ...process.env, TERM: "dumb" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const entry: ShellEntry = {
    id,
    process: child,
    command,
    stdout: "",
    stderr: "",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finished: false,
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    entry.stdout += chunk.toString();
    // Cap buffer to 10MB
    if (entry.stdout.length > 10 * 1024 * 1024) {
      entry.stdout = entry.stdout.slice(-5 * 1024 * 1024);
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    entry.stderr += chunk.toString();
    if (entry.stderr.length > 10 * 1024 * 1024) {
      entry.stderr = entry.stderr.slice(-5 * 1024 * 1024);
    }
  });

  child.on("exit", (code) => {
    entry.exitCode = code;
    entry.finished = true;
  });

  child.on("error", (err) => {
    entry.stderr += `\nProcess error: ${err.message}`;
    entry.finished = true;
  });

  // Auto-kill after timeout
  const timer = setTimeout(() => {
    if (!entry.finished) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!entry.finished) child.kill("SIGKILL");
      }, 5000);
    }
  }, timeout);
  timer.unref();

  shells.set(id, entry);
  return entry;
}

/**
 * Get a shell entry by ID.
 */
export function getShell(id: string): ShellEntry | undefined {
  return shells.get(id);
}

/**
 * Kill a background shell by ID.
 */
export function killShell(id: string): boolean {
  const entry = shells.get(id);
  if (!entry) return false;
  if (!entry.finished) {
    entry.process.kill("SIGTERM");
    setTimeout(() => {
      if (!entry.finished) entry.process.kill("SIGKILL");
    }, 5000);
  }
  return true;
}

/**
 * List all registered shells.
 */
export function listShells(): ShellEntry[] {
  return Array.from(shells.values());
}
