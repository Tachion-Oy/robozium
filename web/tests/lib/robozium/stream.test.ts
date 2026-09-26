import { WireLifecycleStatus } from "@/lib/robozium/wire"
import { describe, expect, it } from "vitest";
import {
  accumulateStreamingDelta,
  getFrameSequence,
  mapFrameToLogItem,
} from "../../../lib/robozium/stream";
import type { MessageDeltaEventFrame } from "../../../lib/robozium/wire";
import {
  PipeEventType,
  RunLifecycleKind,
  WireRole,
} from "../../../lib/robozium/wire";

function deltaFrame(
  overrides: Partial<MessageDeltaEventFrame["payload"]> & { sequence?: number } = {},
): MessageDeltaEventFrame {
  const { sequence = 1, ...payload } = overrides;
  return {
    type: PipeEventType.MessageDelta,
    sequence,
    payload: {
      message_id: "m1",
      delta: "",
      chunk_index: 0,
      role: WireRole.Assistant,
      agent_name: "robozium",
      sequence,
      ...payload,
    },
  };
}
import {
  StreamLogItemKind,
  StreamLogRole,
} from "../../../lib/robozium/view-model";

describe("mapFrameToLogItem", () => {
  it("maps run_lifecycle started into a lifecycle item", () => {
    const receivedAt = "2026-04-24T17:56:00.000Z";
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.RunLifecycle,
        payload: {
          kind: RunLifecycleKind.Started,
          agent_name: "robozium",
          sequence: 1,
          status: WireLifecycleStatus.Running,
        },
      },
      receivedAt,
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Lifecycle,
      role: StreamLogRole.Lifecycle,
      phase: RunLifecycleKind.Started,
      agentName: "robozium",
      startedAt: receivedAt,
      details: {
        status: "running",
      },
    });
  });

  it("maps run_lifecycle started with all payload details into one lifecycle item", () => {
    const receivedAt = "2026-04-24T18:00:00.000Z";
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.RunLifecycle,
        payload: {
          kind: RunLifecycleKind.Started,
          agent_name: "robozium",
          sequence: 1,
          status: null,
          model_name: "gpt-4",
          api_name: "openai",
          max_context_tokens: 128000,
          temperature: 0.2,
          output_format: "json",
        },
      },
      receivedAt,
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Lifecycle,
      role: StreamLogRole.Lifecycle,
      phase: RunLifecycleKind.Started,
      agentName: "robozium",
      startedAt: receivedAt,
      details: {
        model_name: "gpt-4",
        api_name: "openai",
        max_context_tokens: "128000",
        temperature: "0.2",
      },
    });
  });

  it("maps run_lifecycle stopped into a lifecycle end row", () => {
    const receivedAt = "2026-04-24T18:02:00.000Z";
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.RunLifecycle,
        payload: {
          kind: RunLifecycleKind.Stopped,
          agent_name: "robozium",
          sequence: 4,
          status: WireLifecycleStatus.Completed,
        },
      },
      receivedAt,
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Lifecycle,
      role: StreamLogRole.Lifecycle,
      phase: RunLifecycleKind.Stopped,
      agentName: "robozium",
      endedAt: receivedAt,
      status: "completed",
      details: {
        ended_at: receivedAt,
        status: "completed",
      },
    });
  });

  it("maps assistant message events into agent log rows", () => {
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 7,
        payload: {
          role: WireRole.Assistant,
          content: "hello",
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Agent,
      content: "hello",
    });
  });

  it("preserves a user-notification message kind on the log item", () => {
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 8,
        payload: {
          role: WireRole.Assistant,
          content: "### Timesheet",
          truncation: {},
          message_kind: "user_notification",
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Agent,
      content: "### Timesheet",
      hudContent: { text: "### Timesheet", contentType: "markdown" },
      messageKind: "user_notification",
    });
  });

  it("normalizes prompt_user output into the same HUD message field", () => {
    const content = JSON.stringify({
      action: "prompt_user",
      rationale: "Need confirmation",
      value: "Approve these hours?",
    });
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 9,
        payload: {
          role: WireRole.Assistant,
          content,
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Agent,
      content,
      hudContent: { text: "Approve these hours?", contentType: "markdown" },
      parsed: {
        kind: "assistant",
        action: "prompt_user",
        rationale: "Need confirmation",
        extra: { value: "Approve these hours?" },
      },
    });
  });

  it("maps user message events into tool rows", () => {
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 2,
        payload: {
          role: WireRole.User,
          content: '{"caller":"prompt_user_at_start","value":"hello"}',
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Tool,
      content: '{"caller":"prompt_user_at_start","value":"hello"}',
      parsed: {
        kind: "user",
        caller: "prompt_user_at_start",
        extra: { value: "hello" },
      },
    });
  });

  it("maps user startup context messages by remapping kind as caller", () => {
    const content = JSON.stringify({
      value: "# Persistent Memory",
    });
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 9,
        payload: {
          role: WireRole.User,
          content,
          truncation: {},
          message_kind: "startup_context",
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Tool,
      content,
      messageKind: "startup_context",
      parsed: {
        kind: "user",
        caller: "startup_context",
        extra: { value: "# Persistent Memory" },
      },
    });
  });

  it("extracts assistant action/rationale into parsed content", () => {
    const content = JSON.stringify({
      action: "run_repo_command",
      rationale: "inspect files",
      path: ".",
    });
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 3,
        payload: {
          role: WireRole.Assistant,
          content,
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Agent,
      content,
      parsed: {
        kind: "assistant",
        action: "run_repo_command",
        rationale: "inspect files",
        extra: { path: "." },
      },
    });
  });

  it("falls back to raw content when parsed JSON misses required fields", () => {
    const content = JSON.stringify({
      action: "run_repo_command",
      path: ".",
    });
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 4,
        payload: {
          role: WireRole.Assistant,
          content,
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Agent,
      content,
    });
  });

  it("maps system message events as parsed system rows", () => {
    const content = "runtime bound arch=linux/amd64 policy=deny-by-default";
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 5,
        payload: {
          role: WireRole.System,
          content,
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.System,
      content,
      parsed: {
        kind: "system",
        value: content,
      },
    });
  });

  it("maps agent error messages as error rows without JSON parsing", () => {
    const content = "JSONDecodeError: could not parse tool result payload";
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.Message,
        sequence: 6,
        payload: {
          role: WireRole.Error,
          content,
          truncation: {},
        },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Error,
      content,
      parsed: {
        kind: "error",
        value: content,
      },
    });
  });

  it("maps script_output events into script log rows", () => {
    const item = mapFrameToLogItem(
      {
        type: PipeEventType.ScriptOutput,
        sequence: 8,
        payload: { content: "script line" },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(item).toEqual({
      kind: StreamLogItemKind.Message,
      role: StreamLogRole.Script,
      content: "script line",
      hudContent: { text: "script line", contentType: "plain-text" },
    });
  });
});

describe("accumulateStreamingDelta", () => {
  const delta = { messageId: "m1", chunkIndex: 0, agentName: null, role: StreamLogRole.Agent, contentType: "markdown" as const, text: "Hel" };
  it("copies explicit metadata and appends exact text", () => {
    const first = accumulateStreamingDelta(null, delta);
    const second = accumulateStreamingDelta(first, { ...delta, chunkIndex: 1, text: "lo" });
    expect(second).toEqual({ ...delta, chunkIndex: 1, text: "Hello" });
  });
  it("starts fresh for another identity", () => {
    expect(accumulateStreamingDelta(delta, { ...delta, messageId: "m2", text: "new" })).toEqual({ ...delta, messageId: "m2", text: "new" });
  });
});

describe("getFrameSequence", () => {
  it("reads top-level sequence from script output events", () => {
    expect(
      getFrameSequence({
        type: PipeEventType.ScriptOutput,
        sequence: 42,
        payload: { content: "line" },
      }),
    ).toBe(42);
  });

  it("reads top-level sequence from message_delta events", () => {
    expect(getFrameSequence(deltaFrame({ sequence: 99 }))).toBe(99);
  });

  it("reads top-level sequence from runtime events", () => {
    expect(
      getFrameSequence({
        type: PipeEventType.RuntimeEvent,
        sequence: 100,
        payload: {
          category: "tool",
          kind: "timeout",
          level: "error",
          message: "tool timed out",
          agent_name: "root",
          data: null,
        },
      }),
    ).toBe(100);
  });
});
