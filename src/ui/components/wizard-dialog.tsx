/**
 * WizardDialog — multi-purpose wizard step component for interactive flows.
 *
 * Renders one step at a time based on step type:
 * - select:      Arrow-key navigation, Enter to pick
 * - text:        Single/multiline text input with placeholder
 * - multiselect: Checkbox list, Space to toggle, Enter to continue
 * - confirm:     Summary display with action keys (s/Enter=save, e=edit, Esc=cancel)
 *
 * Used by commands that need sequential wizard flows (e.g. /agents create).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import type { WizardStep } from "../state.js";

interface WizardDialogProps {
  step: WizardStep;
  onComplete: (result: string | string[] | null) => void;
  title?: string;
}

// ── Select Step ───────────────────────────────────────────────────────

function SelectStep({
  step,
  onComplete,
}: {
  step: Extract<WizardStep, { type: "select" }>;
  onComplete: (result: string | null) => void;
}) {
  const [cursor, setCursor] = useState(0);

  useInput((_input, key) => {
    if (key.escape) {
      onComplete(null);
      return;
    }
    if (key.return) {
      const selected = step.items[cursor];
      if (selected) onComplete(selected.id);
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : step.items.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < step.items.length - 1 ? c + 1 : 0));
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{chalk.bold(step.header)}</Text>
      {step.subtitle && <Text>{chalk.dim(step.subtitle)}</Text>}
      <Text>{""}</Text>
      {step.items.map((item, i) => {
        const isCurrent = i === cursor;
        const prefix = isCurrent ? chalk.cyan("\u276F") : " ";
        const label = isCurrent ? chalk.cyan(item.label) : item.label;
        const desc = item.description ? chalk.dim(` — ${item.description}`) : "";
        return (
          <Text key={item.id}>{"  "}{prefix} {label}{desc}</Text>
        );
      })}
      <Text>{""}</Text>
      <Text>{chalk.dim("  \u2191\u2193 navigate \u00B7 Enter select \u00B7 Esc cancel")}</Text>
    </Box>
  );
}

// ── Text Step ─────────────────────────────────────────────────────────

function TextStep({
  step,
  onComplete,
}: {
  step: Extract<WizardStep, { type: "text" }>;
  onComplete: (result: string | null) => void;
}) {
  const [value, setValue] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onComplete(null);
      return;
    }
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed) onComplete(trimmed);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (input && !key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab) {
      setValue((v) => v + input);
    }
  });

  const placeholder = !value && step.placeholder ? chalk.dim(step.placeholder) : "";

  return (
    <Box flexDirection="column">
      <Text>{chalk.bold(step.header)}</Text>
      {step.subtitle && <Text>{chalk.dim(step.subtitle)}</Text>}
      <Text>{""}</Text>
      <Text>{"  "}{chalk.cyan("\u276F")} {value || placeholder}{chalk.cyan("\u2588")}</Text>
      {step.multiline && (
        <Text>{chalk.dim("  (single-line input)")}</Text>
      )}
      <Text>{""}</Text>
      <Text>{chalk.dim("  Enter to submit \u00B7 Esc to cancel")}</Text>
    </Box>
  );
}

// ── Multiselect Step ──────────────────────────────────────────────────

function MultiselectStep({
  step,
  onComplete,
}: {
  step: Extract<WizardStep, { type: "multiselect" }>;
  onComplete: (result: string[] | null) => void;
}) {
  const [cursor, setCursor] = useState(0);
  const [checked, setChecked] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of step.items) {
      if (item.checked) initial.add(item.id);
    }
    return initial;
  });

  useInput((input, key) => {
    if (key.escape) {
      onComplete(null);
      return;
    }
    if (key.return) {
      onComplete(Array.from(checked));
      return;
    }
    if (key.upArrow) {
      setCursor((c) => (c > 0 ? c - 1 : step.items.length - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => (c < step.items.length - 1 ? c + 1 : 0));
      return;
    }
    if (input === " ") {
      const item = step.items[cursor];
      if (item) {
        setChecked((prev) => {
          const next = new Set(prev);
          if (next.has(item.id)) next.delete(item.id);
          else next.add(item.id);
          return next;
        });
      }
      return;
    }
  });

  return (
    <Box flexDirection="column">
      <Text>{chalk.bold(step.header)}</Text>
      {step.subtitle && <Text>{chalk.dim(step.subtitle)}</Text>}
      <Text>{""}</Text>
      {step.items.map((item, i) => {
        const isCurrent = i === cursor;
        const isChecked = checked.has(item.id);
        const checkbox = isChecked ? chalk.green("[x]") : "[ ]";
        const label = isCurrent ? chalk.cyan(item.label) : item.label;
        return (
          <Text key={item.id}>{"  "}{isCurrent ? chalk.cyan("\u276F") : " "} {checkbox} {label}</Text>
        );
      })}
      <Text>{""}</Text>
      <Text>{chalk.dim("  Space toggle \u00B7 Enter continue \u00B7 Esc cancel")}</Text>
    </Box>
  );
}

// ── Confirm Step ──────────────────────────────────────────────────────

function ConfirmStep({
  step,
  onComplete,
}: {
  step: Extract<WizardStep, { type: "confirm" }>;
  onComplete: (result: string | null) => void;
}) {
  useInput((input, key) => {
    if (key.escape) {
      onComplete(null);
      return;
    }
    // Match action keys
    for (const action of step.actions) {
      if (action.key === "Enter" && key.return) {
        onComplete(action.key);
        return;
      }
      if (input === action.key) {
        onComplete(action.key);
        return;
      }
    }
    // Enter always works as default confirm
    if (key.return && step.actions.length > 0) {
      onComplete(step.actions[0].key);
      return;
    }
  });

  const actionHints = step.actions
    .map((a) => `${a.key === "Enter" ? "Enter" : a.key}=${a.label}`)
    .join(" \u00B7 ");

  return (
    <Box flexDirection="column">
      <Text>{chalk.bold(step.header)}</Text>
      <Text>{""}</Text>
      {step.lines.map((line, i) => (
        <Text key={i}>{"  "}{line}</Text>
      ))}
      <Text>{""}</Text>
      <Text>{chalk.dim(`  ${actionHints} \u00B7 Esc cancel`)}</Text>
    </Box>
  );
}

// ── Main WizardDialog ─────────────────────────────────────────────────

export function WizardDialog({ step, onComplete, title }: WizardDialogProps): React.ReactElement {
  const cols = process.stdout.columns || 80;
  const width = Math.min(cols - 4, 72);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={2}
      paddingY={1}
      width={width}
    >
      {title && (
        <>
          <Text>{chalk.bold.cyan(title)}</Text>
          <Text>{chalk.dim("\u2500".repeat(width - 6))}</Text>
        </>
      )}

      {step.type === "select" && (
        <SelectStep step={step} onComplete={(r) => onComplete(r)} />
      )}
      {step.type === "text" && (
        <TextStep step={step} onComplete={(r) => onComplete(r)} />
      )}
      {step.type === "multiselect" && (
        <MultiselectStep step={step} onComplete={(r) => onComplete(r)} />
      )}
      {step.type === "confirm" && (
        <ConfirmStep step={step} onComplete={(r) => onComplete(r)} />
      )}
    </Box>
  );
}
