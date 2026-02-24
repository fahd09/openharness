/**
 * AskUserQuestion tool — presents interactive multi-choice questions to the user.
 *
 * When no requestUserInput callback is available (subagent or pipe mode),
 * auto-selects the first option for each question.
 */

import { z } from "zod";
import type { Tool, ToolContext, UserQuestion } from "./tool-registry.js";

const optionSchema = z.object({
  label: z.string().describe("Display text for this option (1-5 words)"),
  description: z.string().describe("Explanation of what this option means"),
});

const questionSchema = z.object({
  question: z.string().describe("The question to ask the user"),
  header: z.string().describe("Short label displayed as a chip/tag (max 12 chars)"),
  options: z
    .array(optionSchema)
    .min(2)
    .max(4)
    .describe("2-4 available choices"),
  multiSelect: z.boolean().describe("Allow multiple selections"),
});

const inputSchema = z.object({
  questions: z
    .array(questionSchema)
    .min(1)
    .max(4)
    .describe("Questions to ask the user (1-4)"),
  answers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Pre-filled answers (keyed by question text)"),
  metadata: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional metadata for tracking"),
});

export const askUserQuestionTool: Tool = {
  name: "AskUserQuestion",
  description:
    "Ask the user interactive multi-choice questions. Returns their selections as a JSON object keyed by question text.",
  inputSchema,
  maxResultSizeChars: 50000,
  isConcurrencySafe: () => false,
  isReadOnly: () => true,

  async *call(rawInput: unknown, context: ToolContext) {
    const input = inputSchema.parse(rawInput);

    // If answers are pre-filled, return them directly
    if (input.answers && Object.keys(input.answers).length > 0) {
      yield {
        type: "result",
        content: JSON.stringify(input.answers, null, 2),
      };
      return;
    }

    // Build UserQuestion array
    const questions: UserQuestion[] = input.questions.map((q) => ({
      question: q.question,
      header: q.header,
      options: q.options,
      multiSelect: q.multiSelect,
    }));

    // If no callback (subagent/pipe), auto-select first option per question
    if (!context.requestUserInput) {
      const autoAnswers: Record<string, string> = {};
      for (const q of questions) {
        autoAnswers[q.question] = q.options[0].label;
      }
      yield {
        type: "result",
        content: JSON.stringify(autoAnswers, null, 2),
      };
      return;
    }

    // Interactive mode — prompt the user
    yield { type: "progress", content: "Waiting for user input..." };

    const answers = await context.requestUserInput(questions);

    yield {
      type: "result",
      content: JSON.stringify(answers, null, 2),
    };
  },
};
