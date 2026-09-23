import { slog, swarn } from "./log";
import { type PipeEventFrame, zPipeEventFrame } from "./wire";

const DATA_PREFIX = "data: ";
const FRAME_SEPARATOR = "\n\n";

/**
 * Decode one SSE `data:` payload into a known pipe frame. Returns `null` for
 * malformed JSON, non-object payloads, or unrecognized `type` discriminators
 * (forward-compat: the server may add new event kinds).
 */
export function decodePipeEventFrame(data: string): PipeEventFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
  } catch {
    return null;
  }
  const decoded = zPipeEventFrame.safeParse(parsed);
  if (!decoded.success) {
    slog("sse", "dropped malformed/unknown frame");
    return null;
  }
  return decoded.data;
}

function* framesFromBlock(block: string): Generator<PipeEventFrame> {
  for (const line of block.split("\n")) {
    if (!line.startsWith(DATA_PREFIX)) continue;
    const frame = decodePipeEventFrame(line.slice(DATA_PREFIX.length));
    if (frame !== null) yield frame;
  }
}

/**
 * Consume a `text/event-stream` body and yield decoded pipe frames. Splits on
 * double-newline, skips comments and unknown frames, and releases the reader
 * lock on completion (including on consumer-side abort / `break`).
 */
export async function* parsePipeEventStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<PipeEventFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let frameCount = 0;
  slog("sse", "reader started");

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer +=
        value !== undefined
          ? decoder.decode(value, { stream: true })
          : decoder.decode();

      let sep: number;
      while ((sep = buffer.indexOf(FRAME_SEPARATOR)) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + FRAME_SEPARATOR.length);
        const frames = [...framesFromBlock(block)];
        if (frames.length > 0) {
          frameCount += frames.length;
          slog("sse", `yielding ${frames.length} frame(s) (total ${frameCount})`);
        }
        yield* frames;
      }

      if (done) {
        slog("sse", `reader done after ${frameCount} frame(s)`);
        return;
      }
    }
  } catch (err) {
    if (signal?.aborted && isAbortError(err)) {
      slog("sse", `reader aborted after ${frameCount} frame(s)`);
      return;
    }
    swarn("sse", `reader error after ${frameCount} frame(s)`, err);
    throw err;
  } finally {
    reader.releaseLock();
    slog("sse", "reader lock released");
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
