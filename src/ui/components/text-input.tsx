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

import React, { useState, useCallback, useImperativeHandle, forwardRef } from "react";
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
    const fullInput = multiLineBuffer
      ? multiLineBuffer + "\n" + text
      : text;

    // Check for backslash continuation
    if (text.endsWith("\\")) {
      setMultiLineBuffer(
        (multiLineBuffer ? multiLineBuffer + "\n" : "") + text.slice(0, -1)
      );
      setIsMultiLine(true);
      setValue("");
      setCursor(0);
      return;
    }

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
    onSubmit(fullInput, activeMentions);
  }, [multiLineBuffer, mentions, onSubmit]);

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

      // Escape — clear line and mentions
      if (key.escape) {
        setValue("");
        setCursor(0);
        setMultiLineBuffer("");
        setIsMultiLine(false);
        setMentions([]);
        return;
      }

      // Enter — submit
      if (key.return) {
        submit(value);
        return;
      }

      // Tab — completion
      if (key.tab && completer) {
        const [completions] = completer(value);
        if (completions.length === 1) {
          setValue(completions[0] + " ");
          setCursor(completions[0].length + 1);
        }
        // Multiple completions: could show menu (future enhancement)
        return;
      }

      // Backspace — Ink maps the physical Backspace key (\x7F) to key.delete,
      // and only maps \x08 (Ctrl+H) to key.backspace. Treat both as backspace.
      if (key.backspace || key.delete) {
        if (cursor > 0) {
          setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor));
          setCursor((c) => c - 1);
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

      // Up arrow — history
      if (key.upArrow) {
        if (history.length > 0) {
          const newIdx =
            historyIdx === -1 ? history.length - 1 : Math.max(0, historyIdx - 1);
          setHistoryIdx(newIdx);
          setValue(history[newIdx]);
          setCursor(history[newIdx].length);
        }
        return;
      }

      // Down arrow — history
      if (key.downArrow) {
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
        setValue((v) => v.slice(cursor));
        setCursor(0);
        return;
      }

      // Ctrl+K — delete to end
      if (key.ctrl && input === "k") {
        setValue((v) => v.slice(0, cursor));
        return;
      }

      // Ctrl+W — delete word backward
      if (key.ctrl && input === "w") {
        const before = value.slice(0, cursor);
        const trimmed = before.trimEnd();
        const lastSpace = trimmed.lastIndexOf(" ");
        const newCursor = lastSpace === -1 ? 0 : lastSpace + 1;
        setValue(value.slice(0, newCursor) + value.slice(cursor));
        setCursor(newCursor);
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
        setValue((v) => v.slice(0, cursor) + input + v.slice(cursor));
        setCursor((c) => c + input.length);
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
      const display = highlightMentions(value, mentions);
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
  // with @mentions highlighted in cyan
  const before = highlightMentions(value.slice(0, cursor), mentions);
  const cursorChar = cursor < value.length ? value[cursor] : " ";
  const after = highlightMentions(value.slice(cursor + 1), mentions);
  const displayValue = before + chalk.inverse(cursorChar) + after;

  // Build buffer lines for multi-line display
  const bufferLines = isMultiLine && multiLineBuffer
    ? multiLineBuffer.split("\n")
    : [];

  return (
    <Box flexDirection="column">
      <Text>{separator}</Text>
      {bufferLines.map((line, i) => (
        <Text key={i}>{i === 0 ? prompt : chalk.dim("... ")}{chalk.dim(line)}</Text>
      ))}
      <Text>{promptPrefix}{displayValue}</Text>
      <Text>{separator}</Text>
    </Box>
  );
});
