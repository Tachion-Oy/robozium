import { WireLifecycleStatus } from "@/lib/robosprawl/wire"
import { describe, expect, it } from "vitest";
import {
  accumulateStreamingDelta,
  getFrameSequence,
  mapFrameToLogItems,
  runViewTraceToLogItems,
} from "../../../lib/robosprawl/stream";
import type { MessageDeltaEventFrame } from "../../../lib/robosprawl/wire";
import {
  PipeEventType,
  RunLifecycleKind,
  WireRole,
} from "../../../lib/robosprawl/wire";

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
      agent_name: "robosprawl",
      sequence,
      ...payload,
    },
  };
}
import {
  StreamLogItemKind,
  StreamLogRole,
} from "../../../lib/robosprawl/view-model";

describe("mapFrameToLogItems", () => {
  it("maps run_lifecycle started into a lifecycle item", () => {
    const receivedAt = "2026-04-24T17:56:00.000Z";
    const items = mapFrameToLogItems(
      {
        type: PipeEventType.RunLifecycle,
        payload: {
          kind: RunLifecycleKind.Started,
          agent_name: "robosprawl",
          sequence: 1,
          status: WireLifecycleStatus.Running,
        },
      },
      receivedAt,
    );

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Lifecycle,
        role: StreamLogRole.Lifecycle,
        phase: RunLifecycleKind.Started,
        agentName: "robosprawl",
        startedAt: receivedAt,
        details: {
          status: "running",
        },
      },
    ]);
  });

  it("maps run_lifecycle started with all payload details into one lifecycle item", () => {
    const receivedAt = "2026-04-24T18:00:00.000Z";
    const items = mapFrameToLogItems(
      {
        type: PipeEventType.RunLifecycle,
        payload: {
          kind: RunLifecycleKind.Started,
          agent_name: "robosprawl",
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Lifecycle,
        role: StreamLogRole.Lifecycle,
        phase: RunLifecycleKind.Started,
        agentName: "robosprawl",
        startedAt: receivedAt,
        details: {
          model_name: "gpt-4",
          api_name: "openai",
          max_context_tokens: "128000",
          temperature: "0.2",
        },
      },
    ]);
  });

  it("maps run_lifecycle stopped into a lifecycle end row", () => {
    const receivedAt = "2026-04-24T18:02:00.000Z";
    const items = mapFrameToLogItems(
      {
        type: PipeEventType.RunLifecycle,
        payload: {
          kind: RunLifecycleKind.Stopped,
          agent_name: "robosprawl",
          sequence: 4,
          status: WireLifecycleStatus.Completed,
        },
      },
      receivedAt,
    );

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Lifecycle,
        role: StreamLogRole.Lifecycle,
        phase: RunLifecycleKind.Stopped,
        agentName: "robosprawl",
        endedAt: receivedAt,
        status: "completed",
        details: {
          ended_at: receivedAt,
          status: "completed",
        },
      },
    ]);
  });

  it("maps assistant message events into agent log rows", () => {
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Agent,
        content: "hello",
      },
    ]);
  });

  it("preserves a user-notification message kind on the log item", () => {
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Agent,
        content: "### Timesheet",
        hudText: "### Timesheet",
        messageKind: "user_notification",
      },
    ]);
  });

  it("normalizes prompt_user output into the same HUD message field", () => {
    const content = JSON.stringify({
      action: "prompt_user",
      rationale: "Need confirmation",
      value: "Approve these hours?",
    });
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Agent,
        content,
        hudText: "Approve these hours?",
        parsed: {
          kind: "assistant",
          action: "prompt_user",
          rationale: "Need confirmation",
          extra: { value: "Approve these hours?" },
        },
      },
    ]);
  });

  it("maps user message events into tool rows", () => {
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Tool,
        content: '{"caller":"prompt_user_at_start","value":"hello"}',
        parsed: {
          kind: "user",
          caller: "prompt_user_at_start",
          extra: { value: "hello" },
        },
      },
    ]);
  });

  it("maps user startup context messages by remapping kind as caller", () => {
    const content = JSON.stringify({
      value: "# Persistent Memory",
    });
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Tool,
        content,
        messageKind: "startup_context",
        parsed: {
          kind: "user",
          caller: "startup_context",
          extra: { value: "# Persistent Memory" },
        },
      },
    ]);
  });

  it("extracts assistant action/rationale into parsed content", () => {
    const content = JSON.stringify({
      action: "run_repo_command",
      rationale: "inspect files",
      path: ".",
    });
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Agent,
        content,
        parsed: {
          kind: "assistant",
          action: "run_repo_command",
          rationale: "inspect files",
          extra: { path: "." },
        },
      },
    ]);
  });

  it("falls back to raw content when parsed JSON misses required fields", () => {
    const content = JSON.stringify({
      action: "run_repo_command",
      path: ".",
    });
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Agent,
        content,
      },
    ]);
  });

  it("maps system message events as parsed system rows", () => {
    const content = "runtime bound arch=linux/amd64 policy=deny-by-default";
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.System,
        content,
        parsed: {
          kind: "system",
          value: content,
        },
      },
    ]);
  });

  it("maps agent error messages as error rows without JSON parsing", () => {
    const content = "JSONDecodeError: could not parse tool result payload";
    const items = mapFrameToLogItems(
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

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Error,
        content,
        parsed: {
          kind: "error",
          value: content,
        },
      },
    ]);
  });

  it("maps script_output events into script log rows", () => {
    const items = mapFrameToLogItems(
      {
        type: PipeEventType.ScriptOutput,
        sequence: 8,
        payload: { content: "script line" },
      },
      "2026-04-24T17:56:00.000Z",
    );

    expect(items).toEqual([
      {
        kind: StreamLogItemKind.Message,
        role: StreamLogRole.Script,
        content: "script line",
      },
    ]);
  });

  it("drops non-loggable frames from run_view trace conversion", () => {
    expect(
      runViewTraceToLogItems([
        deltaFrame({ delta: "tok" }),
        {
          type: PipeEventType.RuntimeEvent,
          sequence: 88,
          payload: {
            category: "tool",
            kind: "timeout",
            level: "error",
            message: "tool timed out",
            agent_name: "root",
            data: null,
          },
        },
      ]),
    ).toEqual([]);
  });
});

describe("accumulateStreamingDelta", () => {
  it("starts a new streaming message from the first delta", () => {
    expect(
      accumulateStreamingDelta(null, deltaFrame({ message_id: "m1", delta: "Hel" })),
    ).toEqual({ messageId: "m1", text: "Hel", agentName: "robosprawl" });
  });

  it("appends consecutive deltas for the same message", () => {
    const first = accumulateStreamingDelta(
      null,
      deltaFrame({ message_id: "m1", delta: "Hel" }),
    );
    const second = accumulateStreamingDelta(
      first,
      deltaFrame({ message_id: "m1", delta: "lo" }),
    );
    expect(second).toEqual({ messageId: "m1", text: "Hello", agentName: "robosprawl" });
  });

  it("resets when a delta for a different message arrives", () => {
    const prev = { messageId: "m1", text: "old", agentName: "robosprawl" };
    expect(
      accumulateStreamingDelta(
        prev,
        deltaFrame({ message_id: "m2", delta: "new", agent_name: "child" }),
      ),
    ).toEqual({ messageId: "m2", text: "new", agentName: "child" });
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
