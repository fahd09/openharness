import { createCliToolPlugin } from "./cli-tool.js";

export const cliRgPlugin = createCliToolPlugin({
  command: "rg",
  description:
    "ripgrep — extremely fast text search across files. Respects .gitignore. Use instead of grep.",
  examples: [
    'rg "TODO" --type ts                    # Find all TODO comments in TypeScript files',
    'rg "function.*export" src/             # Find exported functions in src/',
    'rg -l "import.*React" --type tsx        # List files that import React',
    'rg "class\\s+\\w+Service" -n            # Find service class definitions with line numbers',
    'rg "password" --type-not test           # Search for "password" excluding test files',
  ],
  notes:
    "Prefer rg over grep for speed and .gitignore awareness. Use --type for language filtering. Use -l for file names only.",
});
