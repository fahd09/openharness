/**
 * Bash Output Analyzer.
 *
 * When bash command output exceeds BASH_MAX_OUTPUT_LENGTH (default 30K chars),
 * this module runs a one-shot API call to determine if the output should be
 * summarized. Verbose build logs, test suites, and repetitive output get
 * intelligently compressed instead of blindly truncated.
 *
 * Matches the original's Bash Output Analyzer prompt and XML-tagged response.
 */
import { getProvider } from "./providers/index.js";
import { loadPrompt } from "./prompt-loader.js";

// Configurable thresholds (match original's BASH_MAX_OUTPUT_LENGTH / _MAX)
const DEFAULT_THRESHOLD = 30000;
const MAX_ANALYZER_INPUT = 150000;

function getThreshold(): number {
  const env = process.env.BASH_MAX_OUTPUT_LENGTH;
  if (env) {
    const parsed = parseInt(env, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_THRESHOLD;
}

/**
 * Parse XML-tagged response from the analyzer.
 */
function parseAnalyzerResponse(text: string): {
  shouldSummarize: boolean;
  reason: string;
  summary?: string;
} {
  const shouldSummarize =
    /<should_summarize>\s*(true)\s*<\/should_summarize>/i.test(text);
  const reasonMatch = text.match(
    /<reason>([\s\S]*?)<\/reason>/
  );
  const summaryMatch = text.match(
    /<summary>([\s\S]*?)<\/summary>/
  );

  return {
    shouldSummarize,
    reason: reasonMatch?.[1]?.trim() ?? "",
    summary: summaryMatch?.[1]?.trim(),
  };
}

/**
 * Analyze bash output and return either a summary or the original output.
 *
 * If the output exceeds the threshold, sends it to a fast model for analysis.
 * The analyzer decides whether to summarize (repetitive logs, build output)
 * or preserve (meaningful output the user needs to see).
 *
 * @param command The bash command that was run
 * @param output The raw output from the command
 * @param model The model to use for analysis (uses same model as parent)
 * @returns Processed output — either summary or truncated original
 */
export async function analyzeBashOutput(
  command: string,
  output: string,
  model: string
): Promise<string> {
  const threshold = getThreshold();

  // Below threshold — return as-is
  if (output.length <= threshold) {
    return output;
  }

  // Cap input to the analyzer to avoid sending enormous payloads
  const analyzerInput = output.length > MAX_ANALYZER_INPUT
    ? output.slice(0, MAX_ANALYZER_INPUT) + `\n\n... (${output.length - MAX_ANALYZER_INPUT} chars truncated for analysis)`
    : output;

  try {
    const provider = getProvider();

    const response = await provider.complete({
      model,
      maxTokens: 4096,
      messages: [
        {
          role: "user",
          content: `${loadPrompt("bash-analyzer")}\n\nCommand: ${command}\n\nOutput (${output.length} chars):\n${analyzerInput}`,
        },
      ],
    });

    const responseText = response.text;

    const parsed = parseAnalyzerResponse(responseText);

    if (parsed.shouldSummarize && parsed.summary) {
      return `[Output summarized — original was ${output.length} chars]\n\n${parsed.summary}`;
    }

    // Analyzer said don't summarize — truncate to threshold
    if (output.length > threshold) {
      return output.slice(0, threshold) + `\n\n... (truncated, ${output.length - threshold} chars omitted)`;
    }
    return output;
  } catch {
    // If analysis fails, fall back to simple truncation
    if (output.length > threshold) {
      return output.slice(0, threshold) + `\n\n... (truncated, ${output.length - threshold} chars omitted)`;
    }
    return output;
  }
}

/**
 * Check if bash output exceeds the summarization threshold.
 */
export function needsBashAnalysis(output: string): boolean {
  return output.length > getThreshold();
}
