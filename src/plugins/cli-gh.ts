import { createCliToolPlugin } from "./cli-tool.js";

export const cliGhPlugin = createCliToolPlugin({
  command: "gh",
  description:
    "gh — GitHub CLI for interacting with GitHub from the terminal.",
  examples: [
    "gh pr list                               # List open pull requests",
    "gh pr create --title 'Fix bug' --body 'Details...'  # Create PR",
    "gh issue list --label bug                # List bug issues",
    "gh pr view 123                           # View PR #123 details",
    "gh pr checks                             # View CI status for current PR",
    "gh api repos/owner/repo/pulls/123/comments  # Read PR comments via API",
  ],
  notes:
    "Use gh for ALL GitHub operations (PRs, issues, releases, checks). Prefer gh over curl for GitHub API calls. Requires authentication via gh auth login.",
});
