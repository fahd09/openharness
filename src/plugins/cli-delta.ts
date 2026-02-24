import { createCliToolPlugin } from "./cli-tool.js";

export const cliDeltaPlugin = createCliToolPlugin({
  command: "delta",
  description:
    "delta — enhanced git diff viewer with syntax highlighting and side-by-side view.",
  examples: [
    "git diff | delta                         # View diff with enhanced formatting",
    "git log -p | delta                       # View commit diffs with delta",
    "delta file1.ts file2.ts                  # Compare two files directly",
  ],
  notes:
    "If configured as git pager, delta is used automatically with git diff/log. Otherwise pipe git output to delta.",
});
