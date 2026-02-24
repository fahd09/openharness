import { createCliToolPlugin } from "./cli-tool.js";

export const cliAstGrepPlugin = createCliToolPlugin({
  command: "ast-grep",
  description:
    "ast-grep — syntax-aware code search and refactoring. Searches by AST structure, not text patterns. More precise than rg for code patterns.",
  examples: [
    'ast-grep --lang ts --pattern "async function $NAME($$$ARGS)" # Find all async function declarations',
    'ast-grep --lang ts --pattern "console.log($$$)"              # Find all console.log calls',
    'ast-grep --lang tsx --pattern "<$TAG onClick={$$$}>$$$</$TAG>" # Find elements with onClick',
    'ast-grep --lang python --pattern "def $NAME(self, $$$):"     # Find Python instance methods',
    'ast-grep --lang ts --pattern "import { $$$ } from \'react\'"   # Find React imports',
  ],
  notes:
    "WHEN TO USE ast-grep vs rg:\n- Use ast-grep for STRUCTURAL code queries (find async functions, find React components, find class methods) — it understands syntax trees\n- Use rg for PLAIN TEXT searches (find TODOs, find string literals, find comments) — it is faster for simple patterns\n- ast-grep supports: --lang ts, --lang tsx, --lang python, --lang rust, --lang go, --lang java, and more\n- $NAME matches a single identifier, $$$ matches multiple arguments/items",
});
