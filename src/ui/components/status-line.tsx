/**
 * StatusLine — displays retry, compact, and per-turn cost information.
 */

import React from "react";
import { Text } from "ink";
import chalk from "chalk";
import type { RetryInfo, CompactInfo, TurnSummary } from "../state.js";

interface Props {
  retryInfo: RetryInfo | null;
  compactInfo: CompactInfo | null;
  turnSummary: TurnSummary | null;
}

export function StatusLine({ retryInfo }: Props): React.ReactElement | null {
  // Only show retry info as a live status (compact and summary are frozen into blocks)
  if (!retryInfo) return null;

  return (
    <Text>
      {chalk.yellow(
        `\u21BB Retry ${retryInfo.attempt}/${retryInfo.max} in ${(retryInfo.delayMs / 1000).toFixed(1)}s \u2014 ${retryInfo.error}`
      )}
    </Text>
  );
}
