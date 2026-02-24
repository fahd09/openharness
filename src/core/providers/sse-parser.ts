/**
 * Generic SSE (Server-Sent Events) parser.
 *
 * Reads from a ReadableStream and yields parsed JSON objects from `data:` lines.
 * Used by both OpenAI-compatible and Gemini providers.
 */

export async function* parseSSE<T>(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<T> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(":")) continue;

      if (trimmed.startsWith("data: ")) {
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;

        try {
          yield JSON.parse(data) as T;
        } catch {
          // Skip malformed JSON
        }
      }
    }
  }
}
