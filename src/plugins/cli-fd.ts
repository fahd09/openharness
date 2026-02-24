import { createCliToolPlugin } from "./cli-tool.js";

export const cliFdPlugin = createCliToolPlugin({
  command: "fd",
  description:
    "fd — fast file finder. Respects .gitignore. Use instead of find.",
  examples: [
    "fd .ts src/                             # Find all .ts files under src/",
    'fd -e json                              # Find all JSON files in current directory',
    'fd "test" --type f                      # Find files with "test" in their name',
    "fd -e ts -x wc -l                      # Count lines in each TypeScript file",
    'fd "config" --hidden                    # Find config files including hidden ones',
  ],
  notes:
    "Prefer fd over find for speed and simpler syntax. Use -e for extension filtering. Use --type f for files only, --type d for directories only.",
});
