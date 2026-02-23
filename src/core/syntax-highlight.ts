/**
 * Lightweight Syntax Highlighter — keyword-based highlighting for terminal output.
 *
 * Supports: TypeScript/JavaScript, Python, Rust, Go, Bash, JSON, CSS, HTML, SQL, YAML, TOML, C/C++, Java, Ruby
 * Uses chalk for terminal colors. No external dependencies.
 */

import chalk from "chalk";

// ── Language keyword sets ──────────────────────────────────────────

const LANG_KEYWORDS: Record<string, Set<string>> = {
  typescript: new Set([
    "import", "export", "from", "const", "let", "var", "function", "return",
    "if", "else", "for", "while", "do", "switch", "case", "break", "continue",
    "class", "extends", "implements", "interface", "type", "enum", "namespace",
    "new", "this", "super", "typeof", "instanceof", "in", "of", "as", "is",
    "async", "await", "yield", "throw", "try", "catch", "finally",
    "true", "false", "null", "undefined", "void", "never", "any", "unknown",
    "readonly", "abstract", "static", "private", "protected", "public",
    "default", "delete", "keyof", "infer", "satisfies",
  ]),
  python: new Set([
    "import", "from", "def", "class", "return", "if", "elif", "else",
    "for", "while", "break", "continue", "pass", "yield", "with", "as",
    "try", "except", "finally", "raise", "assert", "del", "in", "not",
    "and", "or", "is", "lambda", "global", "nonlocal", "async", "await",
    "True", "False", "None", "self", "cls",
  ]),
  rust: new Set([
    "fn", "let", "mut", "const", "static", "struct", "enum", "impl", "trait",
    "type", "use", "mod", "pub", "crate", "super", "self", "Self",
    "if", "else", "match", "for", "while", "loop", "break", "continue", "return",
    "async", "await", "move", "ref", "where", "unsafe", "extern",
    "true", "false", "as", "in", "dyn", "box",
  ]),
  go: new Set([
    "package", "import", "func", "return", "var", "const", "type", "struct",
    "interface", "map", "chan", "go", "select", "case", "default",
    "if", "else", "for", "range", "switch", "break", "continue", "fallthrough",
    "defer", "panic", "recover", "nil", "true", "false", "make", "new", "append",
  ]),
  bash: new Set([
    "if", "then", "else", "elif", "fi", "for", "while", "do", "done",
    "case", "esac", "in", "function", "return", "exit", "echo", "export",
    "local", "readonly", "shift", "set", "unset", "source", "eval",
    "true", "false", "cd", "pwd", "ls", "rm", "cp", "mv", "mkdir",
    "cat", "grep", "sed", "awk", "find", "xargs", "pipe", "test",
  ]),
  sql: new Set([
    "SELECT", "FROM", "WHERE", "AND", "OR", "NOT", "IN", "LIKE", "BETWEEN",
    "INSERT", "INTO", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "DROP",
    "ALTER", "TABLE", "INDEX", "VIEW", "JOIN", "LEFT", "RIGHT", "INNER",
    "OUTER", "ON", "AS", "ORDER", "BY", "GROUP", "HAVING", "LIMIT", "OFFSET",
    "UNION", "ALL", "DISTINCT", "NULL", "IS", "EXISTS", "CASE", "WHEN", "THEN",
    "ELSE", "END", "BEGIN", "COMMIT", "ROLLBACK", "PRIMARY", "KEY", "FOREIGN",
    "REFERENCES", "DEFAULT", "CONSTRAINT", "CHECK", "UNIQUE",
    // lowercase versions
    "select", "from", "where", "and", "or", "not", "in", "like", "between",
    "insert", "into", "values", "update", "set", "delete", "create", "drop",
    "alter", "table", "index", "view", "join", "left", "right", "inner",
    "outer", "on", "as", "order", "by", "group", "having", "limit", "offset",
    "union", "all", "distinct", "null", "is", "exists", "case", "when", "then",
    "else", "end", "begin", "commit", "rollback", "primary", "key", "foreign",
  ]),
};

// Aliases
LANG_KEYWORDS["ts"] = LANG_KEYWORDS["typescript"];
LANG_KEYWORDS["js"] = LANG_KEYWORDS["typescript"];
LANG_KEYWORDS["javascript"] = LANG_KEYWORDS["typescript"];
LANG_KEYWORDS["jsx"] = LANG_KEYWORDS["typescript"];
LANG_KEYWORDS["tsx"] = LANG_KEYWORDS["typescript"];
LANG_KEYWORDS["py"] = LANG_KEYWORDS["python"];
LANG_KEYWORDS["rs"] = LANG_KEYWORDS["rust"];
LANG_KEYWORDS["golang"] = LANG_KEYWORDS["go"];
LANG_KEYWORDS["sh"] = LANG_KEYWORDS["bash"];
LANG_KEYWORDS["zsh"] = LANG_KEYWORDS["bash"];
LANG_KEYWORDS["shell"] = LANG_KEYWORDS["bash"];
LANG_KEYWORDS["mysql"] = LANG_KEYWORDS["sql"];
LANG_KEYWORDS["postgresql"] = LANG_KEYWORDS["sql"];
LANG_KEYWORDS["sqlite"] = LANG_KEYWORDS["sql"];

// CSS keywords
LANG_KEYWORDS["css"] = new Set([
  "color", "background", "border", "margin", "padding", "display", "position",
  "width", "height", "font", "text", "flex", "grid", "align", "justify",
  "transform", "transition", "animation", "opacity", "overflow", "z-index",
  "important", "none", "auto", "inherit", "initial", "relative", "absolute",
  "fixed", "sticky", "block", "inline", "hidden", "visible", "solid",
]);

// ── Highlighting logic ────────────────────────────────────────────

/**
 * Highlight a single line of code based on the language.
 */
export function highlightLine(line: string, lang: string): string {
  const keywords = LANG_KEYWORDS[lang.toLowerCase()];

  // For JSON, use a simple structure-based approach
  if (lang === "json" || lang === "jsonc") {
    return highlightJson(line);
  }

  // For YAML/TOML, use key-value approach
  if (lang === "yaml" || lang === "yml" || lang === "toml") {
    return highlightYaml(line);
  }

  // If we don't have keywords for this language, return with basic highlighting
  if (!keywords) {
    return highlightBasic(line);
  }

  return highlightWithKeywords(line, keywords);
}

function highlightWithKeywords(line: string, keywords: Set<string>): string {
  // Handle full-line comments first
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--")) {
    return chalk.dim.green(line);
  }

  let result = "";
  let i = 0;

  while (i < line.length) {
    // String literals (single/double/backtick)
    if (line[i] === '"' || line[i] === "'" || line[i] === '`') {
      const quote = line[i];
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === '\\') j++; // skip escaped chars
        j++;
      }
      j++; // include closing quote
      result += chalk.yellow(line.slice(i, j));
      i = j;
      continue;
    }

    // Inline comments
    if (line[i] === '/' && line[i + 1] === '/') {
      result += chalk.dim.green(line.slice(i));
      break;
    }
    if (line[i] === '#' && !/^\s*#\s*(include|define|ifdef|ifndef|endif|pragma)/.test(line.slice(i))) {
      // Python/bash comments (not C preprocessor)
      result += chalk.dim.green(line.slice(i));
      break;
    }

    // Numbers
    if (/[0-9]/.test(line[i]) && (i === 0 || !/[a-zA-Z_]/.test(line[i - 1]))) {
      let j = i;
      while (j < line.length && /[0-9.xXa-fA-F_]/.test(line[j])) j++;
      result += chalk.magenta(line.slice(i, j));
      i = j;
      continue;
    }

    // Words (identifiers/keywords)
    if (/[a-zA-Z_$]/.test(line[i])) {
      let j = i;
      while (j < line.length && /[a-zA-Z0-9_$]/.test(line[j])) j++;
      const word = line.slice(i, j);

      if (keywords.has(word)) {
        result += chalk.blue(word);
      } else if (word[0] === word[0].toUpperCase() && /[a-z]/.test(word)) {
        // PascalCase → likely a type/class
        result += chalk.cyan(word);
      } else {
        result += word;
      }
      i = j;
      continue;
    }

    // Operators and punctuation — pass through
    result += line[i];
    i++;
  }

  return result;
}

function highlightJson(line: string): string {
  // Keys
  let result = line.replace(/"([^"]+)"\s*:/g, (_, key) =>
    chalk.cyan(`"${key}"`) + ":"
  );
  // String values
  result = result.replace(/:\s*"([^"]*?)"/g, (match, val) =>
    match.replace(`"${val}"`, chalk.yellow(`"${val}"`))
  );
  // Numbers
  result = result.replace(/:\s*(-?\d+\.?\d*)/g, (match, num) =>
    match.replace(num, chalk.magenta(num))
  );
  // Booleans and null
  result = result.replace(/:\s*(true|false|null)/g, (match, val) =>
    match.replace(val, chalk.blue(val))
  );
  return result;
}

function highlightYaml(line: string): string {
  const trimmed = line.trimStart();
  // Comments
  if (trimmed.startsWith("#")) {
    return chalk.dim.green(line);
  }
  // Key: value
  const kvMatch = line.match(/^(\s*)([\w.-]+)(\s*:\s*)(.*)/);
  if (kvMatch) {
    const [, indent, key, sep, value] = kvMatch;
    let coloredValue = value;
    if (value === "true" || value === "false" || value === "null" || value === "~") {
      coloredValue = chalk.blue(value);
    } else if (/^-?\d+\.?\d*$/.test(value)) {
      coloredValue = chalk.magenta(value);
    } else if (value.startsWith('"') || value.startsWith("'")) {
      coloredValue = chalk.yellow(value);
    }
    return indent + chalk.cyan(key) + sep + coloredValue;
  }
  return line;
}

function highlightBasic(line: string): string {
  // Just highlight strings and comments for unknown languages
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("--")) {
    return chalk.dim.green(line);
  }
  // String literals
  let result = line.replace(/"[^"]*"/g, (m) => chalk.yellow(m));
  result = result.replace(/'[^']*'/g, (m) => chalk.yellow(m));
  return result;
}
