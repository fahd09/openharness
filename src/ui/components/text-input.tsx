/**
 * TextInput — Ink-native text input component.
 *
 * Replaces readline with a fully controlled input that lives inside the
 * Ink render tree. Supports:
 * - Single-line editing with cursor movement
 * - Backslash continuation for multi-line input
 * - Tab completion (for slash commands and skills)
 * - Input history (up/down arrows)
 * - @file mentions (inserts highlighted reference, tracked for submit)
 * - Escape to clear
 * - Ctrl+C to interrupt
 * - Ctrl+D to exit
 */

import React, { useState, useCallback, useImperativeHandle, useRef, forwardRef } from "react";
import { Text, Box, useInput } from "ink";
import chalk from "chalk";

export interface TextInputProps {
  /** Called when user submits input (Enter key). */
  onSubmit: (value: string, mentions: string[]) => void;
  /** Called on Ctrl+C. */
  onInterrupt?: () => void;
  /** Called on Ctrl+D (EOF). */
  onExit?: () => void;
  /** Tab completion function: returns [completions, originalLine]. */
  completer?: (line: string) => [string[], string];
  /** Called when user types "@" to trigger file mention. */
  onFileMention?: () => void;
  /** Whether input is active (disabled during processing). */
  isActive?: boolean;
  /** Prompt string. */
  prompt?: string;
}

export interface TextInputHandle {
  /** Insert a file mention at the cursor. Called by parent after file selection. */
  insertMention: (filePath: string) => void;
}

/** Highlight @mention tokens in a text string. */
function highlightMentions(text: string, mentions: string[]): string {
  if (mentions.length === 0) return text;
  let result = text;
  for (const m of mentions) {
    const token = `@${m}`;
    // Split/join to avoid regex issues with special chars in paths
    result = result.split(token).join(chalk.cyan.bold(token));
  }
  return result;
}

// ── Paste collapse helpers ──────────────────────────────────────

interface PastedBlock {
  text: string;
  lines: number;
  num: number;
}

/** Check if a character is a paste marker (Unicode Private Use Area). */
function isPasteMarkerChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code >= 0xE000 && code <= 0xF8FF;
}

/** Replace paste markers with styled labels, then highlight mentions. */
function renderWithPastes(
  text: string,
  mentions: string[],
  pasteMap: Map<string, PastedBlock>,
): string {
  // First highlight mentions (operates on raw text, won't touch PUA chars)
  let result = highlightMentions(text, mentions);
  // Then replace PUA paste markers with styled labels
  for (const [marker, block] of pasteMap) {
    if (result.includes(marker)) {
      const label =
        block.lines > 1
          ? `[Pasted text #${block.num} +${block.lines} lines]`
          : `[Pasted text #${block.num}]`;
      result = result.split(marker).join(chalk.magenta(label));
    }
  }
  return result;
}

/** Expand paste markers back to their original text for submission. */
function expandPasteMarkers(
  text: string,
  pasteMap: Map<string, PastedBlock>,
): string {
  let result = text;
  for (const [marker, block] of pasteMap) {
    result = result.split(marker).join(block.text);
  }
  return result;
}

export const TextInput = forwardRef<TextInputHandle, TextInputProps>(function TextInput(
  {
    onSubmit,
    onInterrupt,
    onExit,
    completer,
    onFileMention,
    isActive = true,
    prompt = chalk.blue("> "),
  },
  ref,
) {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [multiLineBuffer, setMultiLineBuffer] = useState("");
  const [isMultiLine, setIsMultiLine] = useState(false);
  const [mentions, setMentions] = useState<string[]>([]);
  const [completionItems, setCompletionItems] = useState<string[]>([]);
  const [completionCursor, setCompletionCursor] = useState(0);

  // Paste collapse state — refs to avoid stale closures in useInput
  const pasteCounterRef = useRef(0);
  const pasteMapRef = useRef(new Map<string, PastedBlock>());

  // Expose insertMention to parent via ref
  useImperativeHandle(ref, () => ({
    insertMention(filePath: string) {
      const token = `@${filePath} `;
      setValue((v) => v.slice(0, cursor) + token + v.slice(cursor));
      setCursor((c) => c + token.length);
      setMentions((prev) => prev.includes(filePath) ? prev : [...prev, filePath]);
    },
  }), [cursor]);

  const submit = useCallback((text: string) => {
    // Check for backslash continuation (before expanding pastes)
    if (text.endsWith("\\")) {
      setMultiLineBuffer(
        (multiLineBuffer ? multiLineBuffer + "\n" : "") + text.slice(0, -1)
      );
      setIsMultiLine(true);
      setValue("");
      setCursor(0);
      return;
    }

    // Expand paste markers back to full text for submission
    const rawInput = multiLineBuffer
      ? multiLineBuffer + "\n" + text
      : text;
    const fullInput = expandPasteMarkers(rawInput, pasteMapRef.current);

    // Submit
    const trimmed = fullInput.trim();
    if (trimmed) {
      setHistory((prev) => {
        const next = [...prev, trimmed];
        return next.length > 100 ? next.slice(-100) : next;
      });
    }

    // Only include mentions that still appear in the submitted text
    const activeMentions = mentions.filter((m) => fullInput.includes(`@${m}`));

    setHistoryIdx(-1);
    setMultiLineBuffer("");
    setIsMultiLine(false);
    setValue("");
    setCursor(0);
    setMentions([]);
    pasteMapRef.current.clear();
    pasteCounterRef.current = 0;
    onSubmit(fullInput, activeMentions);
  }, [multiLineBuffer, mentions, onSubmit]);

  const updateCompletions = useCallback((newValue: string) => {
    if (!completer || !newValue.startsWith("/") || newValue.includes(" ")) {
      setCompletionItems([]);
      setCompletionCursor(0);
      return;
    }
    const [hits] = completer(newValue);
    setCompletionItems(hits);
    setCompletionCursor(0);
  }, [completer]);

  useInput(
    (input, key) => {
      // Ctrl+C — interrupt
      if (key.ctrl && input === "c") {
        onInterrupt?.();
        return;
      }

      // Ctrl+D — exit on empty line
      if (key.ctrl && input === "d") {
        if (value === "") {
          onExit?.();
        }
        return;
      }

      // Ctrl+T — toggle panel (handled by parent)
      if (key.ctrl && input === "t") {
        return;
      }

      // Escape — close dropdown if open, otherwise clear line and mentions
      if (key.escape) {
        if (completionItems.length > 0) {
          setCompletionItems([]);
          setCompletionCursor(0);
          return;
        }
        setValue("");
        setCursor(0);
        setMultiLineBuffer("");
        setIsMultiLine(false);
        setMentions([]);
        pasteMapRef.current.clear();
        pasteCounterRef.current = 0;
        return;
      }

      // Enter — accept completion if dropdown open, otherwise submit
      if (key.return) {
        if (completionItems.length > 0 && completionCursor >= 0) {
          const selected = completionItems[completionCursor];
          setValue(selected + " ");
          setCursor(selected.length + 1);
          setCompletionItems([]);
          setCompletionCursor(0);
          return;
        }
        submit(value);
        return;
      }

      // Tab — accept completion if dropdown open, otherwise single-match completion
      if (key.tab) {
        if (completionItems.length > 0 && completionCursor >= 0) {
          const selected = completionItems[completionCursor];
          setValue(selected + " ");
          setCursor(selected.length + 1);
          setCompletionItems([]);
          setCompletionCursor(0);
          return;
        }
        if (completer) {
          const [completions] = completer(value);
          if (completions.length === 1) {
            setValue(completions[0] + " ");
            setCursor(completions[0].length + 1);
          }
        }
        return;
      }

      // Backspace — Ink maps the physical Backspace key (\x7F) to key.delete,
      // and only maps \x08 (Ctrl+H) to key.backspace. Treat both as backspace.
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          const newValue = value.slice(0, cursor - 1) + value.slice(cursor);
          setValue(newValue);
          setCursor((c) => c - 1);
          updateCompletions(newValue);
        }
        return;
      }

      // Left arrow
      if (key.leftArrow) {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }

      // Right arrow
      if (key.rightArrow) {
        setCursor((c) => Math.min(value.length, c + 1));
        return;
      }

      // Up arrow — navigate dropdown or history
      if (key.upArrow) {
        if (completionItems.length > 0) {
          setCompletionCursor((prev) =>
            prev <= 0 ? completionItems.length - 1 : prev - 1
          );
          return;
        }
        if (history.length > 0) {
          const newIdx =
            historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
          setHistoryIdx(newIdx);
          setValue(history[newIdx]);
          setCursor(history[newIdx].length);
        }
        return;
      }

      // Down arrow — navigate dropdown or history
      if (key.downArrow) {
        if (completionItems.length > 0) {
          setCompletionCursor((prev) =>
            prev >= completionItems.length - 1 ? 0 : prev + 1
          );
          return;
        }
        if (historyIdx >= 0) {
          const newIdx = historyIdx + 1;
          if (newIdx >= history.length) {
            setHistoryIdx(-1);
            setValue("");
            setCursor(0);
          } else {
            setHistoryIdx(newIdx);
            setValue(history[newIdx]);
            setCursor(history[newIdx].length);
          }
        }
        return;
      }

      // Ctrl+A — start of line
      if (key.ctrl && input === "a") {
        setCursor(0);
        return;
      }

      // Ctrl+E — end of line
      if (key.ctrl && input === "e") {
        setCursor(value.length);
        return;
      }

      // Ctrl+U — delete to start
      if (key.ctrl && input === "u") {
        const newValue = value.slice(cursor);
        setValue(newValue);
        setCursor(0);
        updateCompletions(newValue);
        return;
      }

      // Ctrl+K — delete to end
      if (key.ctrl && input === "k") {
        const newValue = value.slice(0, cursor);
        setValue(newValue);
        updateCompletions(newValue);
        return;
      }

      // Ctrl+W — delete word backward
      if (key.ctrl && input === "w") {
        const before = value.slice(0, cursor);
        const trimmed = before.trimEnd();
        const lastSpace = trimmed.lastIndexOf(" ");
        const newCursor = lastSpace === -1 ? 0 : lastSpace + 1;
        const newValue = value.slice(0, newCursor) + value.slice(cursor);
        setValue(newValue);
        setCursor(newCursor);
        updateCompletions(newValue);
        return;
      }

      // "@" triggers file mention (only when input is empty or after whitespace)
      if (input === "@" && onFileMention) {
        const charBefore = cursor > 0 ? value[cursor - 1] : undefined;
        if (value.length === 0 || charBefore === " " || charBefore === undefined) {
          onFileMention();
          return;
        }
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        // Detect paste: multi-line or very long single-line input
        const hasNewlines = input.includes("\n") || input.includes("\r");
        const isPaste = input.length > 1 && (hasNewlines || input.length > 80);

        if (isPaste) {
          // Collapse pasted text into a single marker character
          const num = pasteCounterRef.current + 1;
          const marker = String.fromCharCode(0xE000 + pasteCounterRef.current);
          pasteCounterRef.current++;
          const cleanText = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
          const lines = cleanText.split("\n").length;
          pasteMapRef.current.set(marker, { text: cleanText, lines, num });
          const newValue = value.slice(0, cursor) + marker + value.slice(cursor);
          setValue(newValue);
          setCursor((c) => c + 1);
          updateCompletions(newValue);
        } else {
          const newValue = value.slice(0, cursor) + input + value.slice(cursor);
          setValue(newValue);
          setCursor((c) => c + input.length);
          updateCompletions(newValue);
        }
      }
    },
    { isActive }
  );

  // Render the input with cursor
  const width = process.stdout.columns || 80;
  const separator = chalk.dim("\u2500".repeat(Math.max(width - 1, 1)));

  if (!isActive) {
    // Show current text (dimmed) when inactive — preserves mention visibility
    if (value) {
      const display = renderWithPastes(value, mentions, pasteMapRef.current);
      return (
        <Box flexDirection="column">
          <Text>{separator}</Text>
          <Text>{chalk.dim("\u276F ")} {display}</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text>{separator}</Text>
        <Text>{chalk.dim("\u276F ")}</Text>
      </Box>
    );
  }

  const promptPrefix = isMultiLine ? chalk.dim("... ") : prompt;

  // Show cursor by inverting the character at cursor position,
  // with @mentions highlighted in cyan and paste markers as labels
  const pasteMap = pasteMapRef.current;
  const before = renderWithPastes(value.slice(0, cursor), mentions, pasteMap);
  const cursorChar = cursor < value.length ? value[cursor] : " ";
  let cursorDisplay: string;
  if (isPasteMarkerChar(cursorChar)) {
    const block = pasteMap.get(cursorChar);
    if (block) {
      const label =
        block.lines > 1
          ? `[Pasted text #${block.num} +${block.lines} lines]`
          : `[Pasted text #${block.num}]`;
      cursorDisplay = chalk.inverse.magenta(label);
    } else {
      cursorDisplay = chalk.inverse(cursorChar);
    }
  } else {
    cursorDisplay = chalk.inverse(cursorChar);
  }
  const after = renderWithPastes(value.slice(cursor + 1), mentions, pasteMap);
  const displayValue = before + cursorDisplay + after;

  // Build buffer lines for multi-line display
  const bufferLines = isMultiLine && multiLineBuffer
    ? multiLineBuffer.split("\n")
    : [];

  // Dropdown viewport
  const MAX_VISIBLE = 8;
  const dropdownOpen = completionItems.length > 0;
  let dropdownStart = 0;
  if (dropdownOpen && completionItems.length > MAX_VISIBLE) {
    dropdownStart = Math.max(
      0,
      Math.min(
        completionCursor - Math.floor(MAX_VISIBLE / 2),
        completionItems.length - MAX_VISIBLE,
      ),
    );
  }
  const dropdownEnd = dropdownOpen
    ? Math.min(dropdownStart + MAX_VISIBLE, completionItems.length)
    : 0;

  return (
    <Box flexDirection="column">
      <Text>{separator}</Text>
      {bufferLines.map((line, i) => (
        <Text key={i}>{i === 0 ? prompt : chalk.dim("... ")}{chalk.dim(line)}</Text>
      ))}
      <Text>{promptPrefix}{displayValue}</Text>
      {dropdownOpen && (
        <Box flexDirection="column" marginLeft={2}>
          {dropdownStart > 0 && <Text>{chalk.dim("  \u2191 more")}</Text>}
          {completionItems.slice(dropdownStart, dropdownEnd).map((item, i) => {
            const idx = dropdownStart + i;
            const isHighlighted = idx === completionCursor;
            return (
              <Text key={item}>
                {isHighlighted
                  ? chalk.bgBlue.white(`\u276F ${item}`)
                  : chalk.dim(`  ${item}`)}
              </Text>
            );
          })}
          {dropdownEnd < completionItems.length && (
            <Text>{chalk.dim("  \u2193 more")}</Text>
          )}
        </Box>
      )}
      <Text>{separator}</Text>
    </Box>
  );
});
