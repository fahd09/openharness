import { createCliToolPlugin } from "./cli-tool.js";

export const cliJqPlugin = createCliToolPlugin({
  command: "jq",
  description:
    "jq — JSON processor. Parse, filter, and transform JSON on the command line.",
  examples: [
    "cat package.json | jq '.dependencies'   # Extract dependencies object",
    "jq '.scripts | keys' package.json       # List all script names",
    "jq '.[] | .name' data.json              # Extract name from each array element",
    'jq -r \'.items[] | "\\(.id): \\(.title)"\' response.json  # Format output',
    "curl -s api.example.com | jq '.data'    # Parse API JSON response",
  ],
  notes:
    "Use jq for any JSON manipulation. Use -r for raw (unquoted) string output. Pipe JSON from curl, cat, or any command.",
});
