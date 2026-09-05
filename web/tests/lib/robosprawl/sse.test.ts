import { describe, expect, it, vi } from "vitest";

import type { PipeEventFrame } from "../../../lib/robosprawl/wire";
import {
  decodePipeEventFrame,
  parsePipeEventStream,
} from "../../../lib/robosprawl/sse";

function streamOfChunks(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      }
      controller.close();
    },
  });
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<PipeEventFrame[]> {
  const out: PipeEventFrame[] = [];
  for await (const frame of parsePipeEventStream(stream, signal)) {
    out.push(frame);
  }
  return out;
}

const MESSAGE_FRAME = {
  type: "message",
  sequence: 1,
  payload: { role: "assistant", content: "hello", truncation: {} },
} as const;

const LIFECYCLE_FRAME = {
  type: "run_lifecycle",
  payload: { kind: "stopped", agent_name: "root", sequence: 3, status: "completed" },
} as const;

const SCRIPT_OUTPUT_FRAME = {
  type: "script_output",
  sequence: 4,
  payload: { content: "script line" },
} as const;

const RUNTIME_EVENT_FRAME = {
  type: "runtime_event",
  sequence: 5,
  payload: {
    category: "tool",
    kind: "timeout",
    level: "error",
    message: "tool timed out",
    agent_name: "root",
    data: { seconds: 10 },
  },
} as const;

describe("decodePipeEventFrame", () => {
  it("returns null for invalid JSON", () => {
    expect(decodePipeEventFrame("not json")).toBeNull();
  });

  it("returns null for primitives", () => {
    expect(decodePipeEventFrame("42")).toBeNull();
    expect(decodePipeEventFrame('"hi"')).toBeNull();
    expect(decodePipeEventFrame("true")).toBeNull();
    expect(decodePipeEventFrame("null")).toBeNull();
  });

  it("returns null for unknown type", () => {
    expect(decodePipeEventFrame('{"type":"unknown","payload":{}}')).toBeNull();
    expect(decodePipeEventFrame('{"type":"future_kind"}')).toBeNull();
  });

  it("accepts message frames", () => {
    const json = JSON.stringify({
      type: "message",
      sequence: 1,
      payload: {
        role: "assistant",
        content: "hello",
        truncation: {},
      },
    });
    expect(decodePipeEventFrame(json)).toEqual(JSON.parse(json));
  });

  it("accepts run_lifecycle frames", () => {
    const json = JSON.stringify({
      type: "run_lifecycle",
      payload: {
        kind: "started",
        agent_name: "root",
        sequence: 1,
        status: "running",
      },
    });
    expect(decodePipeEventFrame(json)).toEqual(JSON.parse(json));
  });

  it("accepts run_lifecycle frames with full robosprawl RunLifecycleEvent payload", () => {
    const json = JSON.stringify({
      type: "run_lifecycle",
      payload: {
        kind: "started",
        agent_name: "root",
        sequence: 1,
        status: null,
        api_name: "openai",
        model_name: "gpt-4",
        max_context_tokens: 128000,
        temperature: 0.0,
        output_format: "text",
      },
    });
    expect(decodePipeEventFrame(json)).toEqual(JSON.parse(json));
  });

  it("accepts script_output frames", () => {
    const json = JSON.stringify(SCRIPT_OUTPUT_FRAME);
    expect(decodePipeEventFrame(json)).toEqual(SCRIPT_OUTPUT_FRAME);
  });

  it("accepts message_delta frames", () => {
    const json = JSON.stringify({
      type: "message_delta",
      sequence: 5,
      payload: {
        message_id: "m1",
        delta: "tok",
        chunk_index: 0,
        role: "assistant",
        agent_name: "robosprawl",
        sequence: 5,
      },
    });
    expect(decodePipeEventFrame(json)).toEqual(JSON.parse(json));
  });

  it("accepts runtime_event frames", () => {
    const json = JSON.stringify(RUNTIME_EVENT_FRAME);
    expect(decodePipeEventFrame(json)).toEqual(RUNTIME_EVENT_FRAME);
  });

  it("accepts run_lifecycle frames without status by defaulting to null", () => {
    const json = JSON.stringify({
      type: "run_lifecycle",
      payload: {
        kind: "started",
        agent_name: "root",
        sequence: 1,
      },
    });
    expect(decodePipeEventFrame(json)).toEqual({
      type: "run_lifecycle",
      payload: {
        kind: "started",
        agent_name: "root",
        sequence: 1,
        status: null,
      },
    });
  });

  it("returns null when payload shape is invalid", () => {
    const badMessage = JSON.stringify({
      type: "message",
      sequence: 1,
      payload: { role: "assistant", content: "oops" },
    });
    expect(decodePipeEventFrame(badMessage)).toBeNull();
  });
});

describe("parsePipeEventStream", () => {
  it("yields a single frame in one chunk", async () => {
    const stream = streamOfChunks([
      `data: ${JSON.stringify(MESSAGE_FRAME)}\n\n`,
    ]);
    await expect(collect(stream)).resolves.toEqual([MESSAGE_FRAME]);
  });

  it("stitches a frame split across chunks", async () => {
    const serialized = `data: ${JSON.stringify(MESSAGE_FRAME)}\n\n`;
    const mid = Math.floor(serialized.length / 2);
    const stream = streamOfChunks([serialized.slice(0, mid), serialized.slice(mid)]);
    await expect(collect(stream)).resolves.toEqual([MESSAGE_FRAME]);
  });

  it("yields multiple frames from one chunk", async () => {
    const stream = streamOfChunks([
      `data: ${JSON.stringify(MESSAGE_FRAME)}\n\n` +
        `data: ${JSON.stringify(LIFECYCLE_FRAME)}\n\n` +
        `data: ${JSON.stringify(SCRIPT_OUTPUT_FRAME)}\n\n` +
        `data: ${JSON.stringify(RUNTIME_EVENT_FRAME)}\n\n`,
    ]);
    await expect(collect(stream)).resolves.toEqual([
      MESSAGE_FRAME,
      LIFECYCLE_FRAME,
      SCRIPT_OUTPUT_FRAME,
      RUNTIME_EVENT_FRAME,
    ]);
  });

  it("skips unknown frames interleaved with known ones", async () => {
    const stream = streamOfChunks([
      `data: {"type":"unknown","payload":{}}\n\n` +
        `data: ${JSON.stringify(LIFECYCLE_FRAME)}\n\n`,
    ]);
    await expect(collect(stream)).resolves.toEqual([LIFECYCLE_FRAME]);
  });

  it("handles a multi-byte UTF-8 codepoint split across chunks", async () => {
    const message = {
      type: "message",
      sequence: 2,
      payload: { role: "assistant", content: "café", truncation: {} },
    } as const;
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify(message)}\n\n`);
    const eAcute = bytes.indexOf(0xc3);
    expect(eAcute).toBeGreaterThan(-1);
    const stream = streamOfChunks([
      bytes.slice(0, eAcute + 1),
      bytes.slice(eAcute + 1),
    ]);
    await expect(collect(stream)).resolves.toEqual([message]);
  });

  it("releases the reader lock when the consumer breaks early", async () => {
    const stream = streamOfChunks([
      `data: ${JSON.stringify(MESSAGE_FRAME)}\n\n` +
        `data: ${JSON.stringify(LIFECYCLE_FRAME)}\n\n`,
    ]);

    for await (const frame of parsePipeEventStream(stream)) {
      expect(frame).toEqual(MESSAGE_FRAME);
      break;
    }

    expect(() => stream.getReader()).not.toThrow();
  });

  it("quietly ends when its owning connection intentionally aborts", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.error(new DOMException("aborted", "AbortError"));
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    controller.abort();

    try {
      await expect(collect(stream, controller.signal)).resolves.toEqual([]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("still warns and rejects an AbortError without an aborted owner", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        streamController.error(new DOMException("aborted", "AbortError"));
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      await expect(collect(stream, controller.signal)).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
