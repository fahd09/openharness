import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

interface ClaudeMdSource {
  label: string;
  path: string;
  content: string;
}

/**
 * Discover and load CLAUDE.md files from standard locations.
 */
export async function loadClaudeMdFiles(cwd: string): Promise<string> {
  const candidates = [
    { label: "User", path: join(homedir(), ".claude", "CLAUDE.md") },
    { label: "Project", path: join(cwd, "CLAUDE.md") },
    { label: "Project", path: join(cwd, ".claude", "CLAUDE.md") },
  ];

  // Also look upward for project root (git root)
  const gitRoot = await findGitRoot(cwd);
  if (gitRoot && gitRoot !== cwd) {
    candidates.push(
      { label: "Project (root)", path: join(gitRoot, "CLAUDE.md") },
      { label: "Project (root)", path: join(gitRoot, ".claude", "CLAUDE.md") }
    );
  }

  const loaded: ClaudeMdSource[] = [];

  for (const candidate of candidates) {
    try {
      const content = await readFile(candidate.path, "utf-8");
      if (content.trim()) {
        // Avoid duplicates
        if (!loaded.some((s) => s.path === candidate.path)) {
          loaded.push({ ...candidate, content: content.trim() });
        }
      }
    } catch {
      // File doesn't exist — skip
    }
  }

  if (loaded.length === 0) return "";

  return loaded
    .map(
      (source) =>
        `# CLAUDE.md (${source.label}: ${source.path})\n\n${source.content}`
    )
    .join("\n\n---\n\n");
}

async function findGitRoot(dir: string): Promise<string | null> {
  const { execFile } = await import("child_process");
  return new Promise((resolve) => {
    execFile(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd: dir },
      (error, stdout) => {
        if (error) resolve(null);
        else resolve(stdout.trim());
      }
    );
  });
}
