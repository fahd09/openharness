/**
 * SessionSelector — interactive session picker with arrow-key navigation.
 *
 * Rendered during "session-select" phase. Uses useInput for keyboard
 * handling: up/down arrows navigate, Enter selects, Esc cancels.
 * Shows a scrolling viewport of ~10 sessions at a time.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";
import type { SessionMetadata } from "../../core/session.js";

const VIEWPORT_SIZE = 10;

interface SessionSelectorProps {
  sessions: SessionMetadata[];
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export function SessionSelector({ sessions, onSelect, onCancel }: SessionSelectorProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (sessions.length > 0) {
        onSelect(sessions[cursor].id);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(sessions.length - 1, c + 1));
      return;
    }
  }, { isActive: true });

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>{chalk.dim("No saved sessions.")}</Text>
      </Box>
    );
  }

  // Table column layout
  const termWidth = process.stdout.columns || 80;
  const GAP = "  ";
  const ID_W = 8;
  const DATE_W = 10;
  const MSGS_W = 4;
  const SRC_W = 2;
  // pointer(4) + id + gap(2) + name + gap(2) + date + gap(2) + msgs + gap(2) + src + paddingLeft(1)
  const FIXED = 4 + ID_W + 2 + 2 + DATE_W + 2 + MSGS_W + 2 + SRC_W + 1;
  const NAME_W = Math.max(12, termWidth - FIXED);

  const oneline = (s: string) => s.replace(/[\r\n]+/g, " ").trim();
  const trunc = (s: string, w: number) =>
    s.length > w ? s.slice(0, w - 1) + "\u2026" : s.padEnd(w);

  const formatRow = (s: SessionMetadata) => {
    const id = trunc(s.id, ID_W);
    const name = trunc(oneline(s.customTitle || s.title), NAME_W);
    const date = s.updatedAt.slice(0, 10).padEnd(DATE_W);
    const msgs = String(s.messageCount).padStart(MSGS_W);
    const src = (s.source === "claude-code" ? "cc" : "").padEnd(SRC_W);
    return `${id}${GAP}${name}${GAP}${date}${GAP}${msgs}${GAP}${src}`;
  };

  const header = `${"ID".padEnd(ID_W)}${GAP}${"Name".padEnd(NAME_W)}${GAP}${"Date".padEnd(DATE_W)}${GAP}${"Msgs".padStart(MSGS_W)}${GAP}${"Src".padEnd(SRC_W)}`;
  const rule = `${"\u2500".repeat(ID_W)}${GAP}${"\u2500".repeat(NAME_W)}${GAP}${"\u2500".repeat(DATE_W)}${GAP}${"\u2500".repeat(MSGS_W)}${GAP}${"\u2500".repeat(SRC_W)}`;

  // Compute viewport window
  const half = Math.floor(VIEWPORT_SIZE / 2);
  let start = Math.max(0, cursor - half);
  let end = start + VIEWPORT_SIZE;
  if (end > sessions.length) {
    end = sessions.length;
    start = Math.max(0, end - VIEWPORT_SIZE);
  }
  const visible = sessions.slice(start, end);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{chalk.dim("Select a session to resume (\u2191\u2193 navigate, Enter select, Esc cancel)")}</Text>
      <Text>{""}</Text>
      <Text>{"    "}{chalk.dim.bold(header)}</Text>
      <Text>{"    "}{chalk.dim(rule)}</Text>
      {start > 0 && (
        <Text>{chalk.dim(`  \u2191 ${start} more above`)}</Text>
      )}
      {visible.map((s, i) => {
        const idx = start + i;
        const isSelected = idx === cursor;
        const row = formatRow(s);
        if (isSelected) {
          return (
            <Text key={s.id}>{"  "}{chalk.bgBlue.white(`\u276f ${row}`)}</Text>
          );
        }
        return (
          <Text key={s.id}>{"    "}{chalk.dim(row)}</Text>
        );
      })}
      {end < sessions.length && (
        <Text>{chalk.dim(`  \u2193 ${sessions.length - end} more below`)}</Text>
      )}
    </Box>
  );
}
