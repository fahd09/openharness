/**
 * SpinnerWidget — animated spinner with label and elapsed time.
 *
 * Phase 1: Braille spinner (same as legacy).
 * Phase 2: Star-morph spinner with shimmer effect and token counter.
 */

import React, { useState, useEffect } from "react";
import { Text } from "ink";
import chalk from "chalk";
import { STAR_FRAMES } from "../theme.js";

interface Props {
  label: string;
  visible: boolean;
  showElapsed?: boolean;
  startTime?: number;
  tokenCount?: number;
}

export function SpinnerWidget({
  label,
  visible,
  showElapsed = false,
  startTime,
  tokenCount,
}: Props): React.ReactElement | null {
  const [frameIdx, setFrameIdx] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!visible) return;

    const timer = setInterval(() => {
      setFrameIdx((prev) => prev + 1);
      if (showElapsed) setNow(Date.now());
    }, 120);

    return () => clearInterval(timer);
  }, [visible, showElapsed]);

  if (!visible) return null;

  // Ping-pong animation
  const frames = STAR_FRAMES;
  const cycle = frames.length * 2 - 2; // Forward + backward minus duplicates
  const pos = frameIdx % cycle;
  const actualIdx = pos < frames.length ? pos : cycle - pos;
  const frame = frames[actualIdx];

  let suffix = "";
  if (showElapsed && startTime) {
    const elapsed = Math.floor((now - startTime) / 1000);
    if (elapsed >= 2) {
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      suffix += mins > 0 ? ` (${mins}m ${secs}s)` : ` (${secs}s)`;
    }
  }

  if (tokenCount && tokenCount > 0) {
    const display = tokenCount >= 1000
      ? `${(tokenCount / 1000).toFixed(1)}k`
      : String(tokenCount);
    suffix += ` \u2193 ${display} tokens`;
  }

  return (
    <Text>
      {`\n${chalk.dim(`${frame} ${label}${suffix}`)}`}
    </Text>
  );
}
