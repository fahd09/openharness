/**
 * QuestionPrompt — Ink component for presenting interactive multi-choice
 * questions to the user. Steps through questions one at a time.
 *
 * Features:
 * - Tab bar showing question progress (checkmarks, current highlight)
 * - Arrow key / number key navigation
 * - Multi-select mode with Space to toggle
 * - "Other" option that switches to free-text input
 * - Esc to cancel text input and return to option list
 */

import React, { useState, useCallback } from "react";
import { Text, Box, useInput } from "ink";
import chalk from "chalk";
import type { QuestionPending, AppAction } from "../state.js";

interface QuestionPromptProps {
  question: QuestionPending;
  dispatch: (action: AppAction) => void;
}

export function QuestionPrompt({ question, dispatch }: QuestionPromptProps): React.ReactElement {
  const { questions, resolve } = question;
  const [currentIdx, setCurrentIdx] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [isTypingOther, setIsTypingOther] = useState(false);
  const [otherText, setOtherText] = useState("");
  const [showReview, setShowReview] = useState(false);
  const isMultiQuestion = questions.length > 1;

  const current = questions[currentIdx];
  // Add "Other" as the last option
  const otherIdx = current.options.length;
  const allOptions = [...current.options, { label: "Type something.", description: "Provide your own answer" }];

  const confirmCurrent = useCallback((answer: string) => {
    const newAnswers = { ...answers, [current.question]: answer };

    if (currentIdx + 1 < questions.length) {
      setAnswers(newAnswers);
      setCurrentIdx(currentIdx + 1);
      setCursor(0);
      setSelected(new Set());
      setIsTypingOther(false);
      setOtherText("");
    } else if (isMultiQuestion) {
      // Show review slide before submitting
      setAnswers(newAnswers);
      setShowReview(true);
    } else {
      resolve(newAnswers);
      dispatch({ type: "QUESTION_RESOLVED" });
    }
  }, [answers, current, currentIdx, questions, isMultiQuestion, resolve, dispatch]);

  // ── Text input mode for "Other" ─────────────────────────────────
  useInput((input, key) => {
    if (!isTypingOther) return;

    // Esc → cancel text input, go back to option list
    if (key.escape) {
      setIsTypingOther(false);
      setOtherText("");
      return;
    }

    // Enter → submit typed text
    if (key.return) {
      const trimmed = otherText.trim();
      if (trimmed) {
        confirmCurrent(trimmed);
      }
      return;
    }

    // Backspace / Delete
    if (key.backspace || key.delete) {
      setOtherText((t) => t.slice(0, -1));
      return;
    }

    // Regular character
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
      setOtherText((t) => t + input);
    }
  }, { isActive: isTypingOther });

  // ── Review slide mode ──────────────────────────────────────────
  useInput((_input, key) => {
    if (!showReview) return;

    if (key.return) {
      resolve(answers);
      dispatch({ type: "QUESTION_RESOLVED" });
      return;
    }

    if (key.escape) {
      // Go back to the last question
      setShowReview(false);
      setCursor(0);
      setSelected(new Set());
      return;
    }
  }, { isActive: showReview });

  // ── Option list mode ────────────────────────────────────────────
  useInput((input, key) => {
    if (isTypingOther || showReview) return;
    if (key.ctrl || key.meta) return;

    // Arrow keys
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : allOptions.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < allOptions.length - 1 ? c + 1 : 0));
      return;
    }

    // Tab cycles forward through questions (for viewing, not skipping)
    if (key.tab) {
      // Only allow tabbing to already-answered questions
      return;
    }

    // Esc cancels entirely — resolve with whatever we have
    if (key.escape) {
      // Fill remaining questions with first option
      const finalAnswers = { ...answers };
      for (let i = currentIdx; i < questions.length; i++) {
        if (!finalAnswers[questions[i].question]) {
          finalAnswers[questions[i].question] = questions[i].options[0]?.label ?? "";
        }
      }
      resolve(finalAnswers);
      dispatch({ type: "QUESTION_RESOLVED" });
      return;
    }

    // Number keys for quick select (1-indexed)
    const num = parseInt(input, 10);
    if (num >= 1 && num <= allOptions.length) {
      const idx = num - 1;
      if (idx === otherIdx) {
        // "Other" option — switch to text input
        setIsTypingOther(true);
        setOtherText("");
        return;
      }
      if (current.multiSelect) {
        setSelected((prev) => {
          const next = new Set(prev);
          if (next.has(idx)) next.delete(idx);
          else next.add(idx);
          return next;
        });
      } else {
        confirmCurrent(allOptions[idx].label);
      }
      return;
    }

    // Space toggles in multi-select mode
    if (input === " " && current.multiSelect) {
      if (cursor === otherIdx) {
        setIsTypingOther(true);
        setOtherText("");
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(cursor)) next.delete(cursor);
        else next.add(cursor);
        return next;
      });
      return;
    }

    // Enter confirms
    if (key.return) {
      if (cursor === otherIdx) {
        // "Other" option — switch to text input
        setIsTypingOther(true);
        setOtherText("");
        return;
      }
      if (current.multiSelect) {
        if (selected.size === 0) return;
        const labels = Array.from(selected)
          .sort()
          .map((i) => allOptions[i].label)
          .join(", ");
        confirmCurrent(labels);
      } else {
        confirmCurrent(allOptions[cursor].label);
      }
      return;
    }
  }, { isActive: !isTypingOther });

  // ── Separator line ──────────────────────────────────────────────
  const cols = process.stdout.columns || 80;
  const separator = chalk.dim("\u2500".repeat(Math.min(cols - 4, 78)));

  // ── Review slide ──────────────────────────────────────────────
  if (showReview) {
    return (
      <Box flexDirection="column" paddingLeft={2}>
        <Box>
          <Text>{chalk.dim("\u2190  ")}</Text>
          {questions.map((q, i) => {
            const sep = i < questions.length - 1 ? chalk.dim("  ") : "";
            return (
              <Text key={i}>{chalk.green("\u2714")} {chalk.green(q.header)}{sep}</Text>
            );
          })}
          <Text>{chalk.dim("  ")}  {chalk.bold.cyan("Review")}</Text>
          <Text>{chalk.dim("  \u2192")}</Text>
        </Box>
        <Text>{separator}</Text>

        <Text>{chalk.bold("Review your answers")}</Text>
        <Text>{""}</Text>

        <Box flexDirection="column">
          {questions.map((q, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <Text>  {chalk.dim(`${i + 1}.`)} {chalk.dim(q.header)}</Text>
              <Text>     {chalk.cyan(answers[q.question] ?? "")}</Text>
            </Box>
          ))}
        </Box>

        <Text>{separator}</Text>
        <Text>{chalk.dim("  Enter to submit \u00B7 Esc to go back")}</Text>
      </Box>
    );
  }

  // ── Tab bar ─────────────────────────────────────────────────────
  const tabBar = isMultiQuestion ? (
    <Box>
      <Text>{chalk.dim("\u2190  ")}</Text>
      {questions.map((q, i) => {
        const isDone = i < currentIdx;
        const isCurrent = i === currentIdx;
        const icon = isDone ? chalk.green("\u2714") : "\u2610";
        const label = isCurrent
          ? chalk.bold.cyan(q.header)
          : isDone
            ? chalk.green(q.header)
            : chalk.dim(q.header);
        const sep = i < questions.length - 1 ? chalk.dim("  ") : "";
        return (
          <Text key={i}>{icon} {label}{sep}</Text>
        );
      })}
      <Text>{chalk.dim("  \u2192")}</Text>
    </Box>
  ) : null;

  return (
    <Box flexDirection="column" paddingLeft={2}>
      {/* Tab bar for multi-question */}
      {tabBar}
      {tabBar && <Text>{separator}</Text>}

      {/* Question text */}
      <Text>
        {chalk.bold(current.question)}
        {current.multiSelect ? chalk.dim(" (multi-select, Space to toggle)") : ""}
      </Text>
      <Text>{""}</Text>

      {/* Options */}
      <Box flexDirection="column">
        {allOptions.map((opt, i) => {
          const isCursorHere = i === cursor && !isTypingOther;
          const isSelected = selected.has(i);
          const isOther = i === otherIdx;

          const prefix = current.multiSelect
            ? (isSelected ? chalk.green("[x]") : "[ ]")
            : (isCursorHere ? chalk.cyan("\u276F") : " ");

          const num = chalk.dim(`${i + 1}.`);
          const label = isOther
            ? (isCursorHere ? chalk.cyan.italic("Type something.") : chalk.italic("Type something."))
            : (isCursorHere ? chalk.cyan(opt.label) : opt.label);

          // Show description indented on next line for non-Other options
          const desc = !isOther && opt.description
            ? `\n       ${chalk.dim(opt.description)}`
            : "";

          return (
            <Text key={i}>
              {"  "}{prefix} {num} {label}{desc}
            </Text>
          );
        })}
      </Box>

      {/* Text input for "Other" */}
      {isTypingOther && (
        <Box marginTop={1}>
          <Text>  {chalk.cyan("\u276F")} {otherText}{chalk.cyan("\u2588")}</Text>
        </Box>
      )}

      {/* Footer */}
      <Text>{separator}</Text>
      {isTypingOther ? (
        <Text>{chalk.dim("  Enter to submit \u00B7 Esc to cancel")}</Text>
      ) : (
        <Text>{chalk.dim("  Enter to select \u00B7 Tab/Arrow keys to navigate \u00B7 Esc to cancel")}</Text>
      )}
    </Box>
  );
}
