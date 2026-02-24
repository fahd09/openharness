import { createCliToolPlugin } from "./cli-tool.js";

export const cliGitPlugin = createCliToolPlugin({
  command: "git",
  description:
    "git — version control. Required for repository operations.",
  examples: [
    "git status                               # Show working tree status",
    "git diff --staged                        # Show staged changes",
    "git log --oneline -10                    # Show last 10 commits",
    "git blame src/index.ts                   # Show who changed each line",
    "git stash && git pull && git stash pop   # Pull changes safely",
  ],
  notes:
    "Always check git status before making changes. Use git diff to review before committing. Never force-push without explicit user approval.",
});
