/**
 * ListSelector — generic interactive list picker with arrow-key navigation.
 *
 * Rendered during "list-select" phase. Uses useInput for keyboard
 * handling: up/down arrows navigate, Enter selects, Esc cancels.
 * Shows a scrolling viewport of ~10 items at a time.
 * Supports grouping items by a `group` field with section headers.
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

const VIEWPORT_SIZE = 10;

export interface ListItem {
  id: string;
  label: string;
  description: string;
  group?: string;
  badge?: string;
  disabled?: boolean;
}

interface ListSelectorProps {
  items: ListItem[];
  header: string;
  onSelect: (id: string) => void;
  onCancel: () => void;
}

export function ListSelector({ items, header, onSelect, onCancel }: ListSelectorProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  // Build display rows: interleave group headers with items
  const rows: Array<{ type: "header"; text: string } | { type: "item"; item: ListItem; index: number }> = [];
  let lastGroup: string | undefined;
  let itemIndex = 0;
  for (const item of items) {
    if (item.group && item.group !== lastGroup) {
      rows.push({ type: "header", text: item.group });
      lastGroup = item.group;
    }
    rows.push({ type: "item", item, index: itemIndex });
    itemIndex++;
  }

  // Selectable indices (non-disabled items)
  const selectableIndices = items.map((item, i) => ({ i, disabled: !!item.disabled }));

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      if (items.length > 0) {
        const selected = items[cursor];
        if (selected?.disabled) return; // skip disabled items
        onSelect(selected.id);
      }
      return;
    }
    if (key.upArrow) {
      setCursor((c) => {
        let next = c - 1;
        while (next >= 0 && items[next]?.disabled) next--;
        return next >= 0 ? next : c;
      });
      return;
    }
    if (key.downArrow) {
      setCursor((c) => {
        let next = c + 1;
        while (next < items.length && items[next]?.disabled) next++;
        return next < items.length ? next : c;
      });
      return;
    }
  }, { isActive: true });

  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>{chalk.dim("No items available.")}</Text>
      </Box>
    );
  }

  // Compute viewport based on cursor position in the rows array
  // First, find the row index of the current cursor item
  const cursorRowIdx = rows.findIndex(
    (r) => r.type === "item" && r.index === cursor
  );

  const half = Math.floor(VIEWPORT_SIZE / 2);
  let start = Math.max(0, cursorRowIdx - half);
  let end = start + VIEWPORT_SIZE;
  if (end > rows.length) {
    end = rows.length;
    start = Math.max(0, end - VIEWPORT_SIZE);
  }
  const visible = rows.slice(start, end);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text>{chalk.dim(`${header} (↑↓ navigate, Enter select, Esc cancel)`)}</Text>
      <Text>{""}</Text>
      {start > 0 && (
        <Text>{chalk.dim(`  ↑ more above`)}</Text>
      )}
      {visible.map((row, vi) => {
        if (row.type === "header") {
          return (
            <Text key={`grp-${vi}`}>
              {"\n  "}{chalk.bold.underline(row.text)}
            </Text>
          );
        }

        const { item, index } = row;
        const isSelected = index === cursor;
        const badge = item.badge ? ` ${chalk.yellow(`[${item.badge}]`)}` : "";
        const desc = item.description ? chalk.dim(` — ${item.description}`) : "";
        const line = `${item.label}${desc}${badge}`;

        if (item.disabled) {
          return (
            <Text key={item.id}>{"    "}{chalk.dim.strikethrough(item.label)}{chalk.dim(` — ${item.description}`)}{badge}</Text>
          );
        }

        if (isSelected) {
          return (
            <Text key={item.id}>{"  "}{chalk.bgBlue.white(`❯ ${line}`)}</Text>
          );
        }
        return (
          <Text key={item.id}>{"    "}{line}</Text>
        );
      })}
      {end < rows.length && (
        <Text>{chalk.dim(`  ↓ more below`)}</Text>
      )}
    </Box>
  );
}
