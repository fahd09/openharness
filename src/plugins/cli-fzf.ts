import { createCliToolPlugin } from "./cli-tool.js";

export const cliFzfPlugin = createCliToolPlugin({
  command: "fzf",
  description:
    "fzf — fuzzy finder for interactive selection. Pipe any list into it for filtering.",
  examples: [
    "fd -e ts | fzf                          # Interactively pick a TypeScript file",
    "rg -l TODO | fzf                        # Pick from files containing TODOs",
    "git branch | fzf                        # Interactively select a branch",
    'git log --oneline | fzf                 # Pick a commit interactively',
  ],
  notes:
    "fzf is most useful when piping results from other commands. It requires interactive terminal — avoid using it in non-interactive scripts.",
});
