import { createCliToolPlugin } from "./cli-tool.js";

export const cliBatPlugin = createCliToolPlugin({
  command: "bat",
  description:
    "bat — better cat with syntax highlighting and line numbers.",
  examples: [
    "bat src/index.ts                         # Display file with syntax highlighting",
    "bat -r 10:20 src/index.ts                # Show lines 10-20 only",
    "bat --diff file1.ts file2.ts             # Show diff between two files",
    "bat -l json <<< '{\"key\": \"value\"}'       # Highlight piped JSON",
  ],
  notes:
    "Use bat instead of cat when you want syntax-highlighted output. Use -r for line ranges. Use -l to specify language for piped input.",
});
