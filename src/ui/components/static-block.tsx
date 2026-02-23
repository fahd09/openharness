/**
 * StaticBlock — renders a single completed block of output.
 * Used inside Ink's <Static> to display frozen content that won't re-render.
 */

import React from "react";
import { Text } from "ink";
import type { CompletedBlock } from "../state.js";

interface Props {
  block: CompletedBlock;
}

export function StaticBlock({ block }: Props): React.ReactElement {
  // All blocks are pre-rendered with chalk — just output the text
  return <Text>{block.text}</Text>;
}
