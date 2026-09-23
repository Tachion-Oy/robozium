"""Unit tests for SSE event adapters."""

from __future__ import annotations

import json

from roboz.models import Message, MessageKind, Role
from roboz.runtime.events import (
    MessageDeltaEvent,
    MessageEvent,
    RunLifecycleEvent,
    RuntimeEvent,
    ScriptOutputEvent,
)

from robozium.api.sse import event_to_sse_frame


def test_event_to_sse_frame_serializes_message_event() -> None:
    event = MessageEvent(
        Message(
            role=Role.ASSISTANT,
            content="hello",
            message_kind=MessageKind.COMPACTED_CONTEXT,
        ),
        sequence=7,
    )
    frame = event_to_sse_frame(event)
    assert frame.startswith("data: ")
    assert frame.endswith("\n\n")
    payload = json.loads(frame[6:-2])
    assert payload["type"] == "message"
    assert payload["sequence"] == 7
    assert payload["payload"]["role"] == "assistant"
    assert payload["payload"]["content"] == "hello"
    assert payload["payload"]["message_kind"] == MessageKind.COMPACTED_CONTEXT.value


def test_event_to_sse_frame_serializes_user_notification() -> None:
    event = MessageEvent(
        Message(
            role=Role.ASSISTANT,
            content='### Timesheet\n\n<file src="readonly/report.csv">CSV</file>',
            message_kind=MessageKind.USER_NOTIFICATION,
        ),
        sequence=11,
    )

    payload = json.loads(event_to_sse_frame(event)[6:-2])

    assert payload["sequence"] == 11
    assert payload["payload"]["role"] == "assistant"
    assert payload["payload"]["message_kind"] == "user_notification"
    assert payload["payload"]["content"].endswith(">CSV</file>")


def test_event_to_sse_frame_serializes_message_event_with_message_id() -> None:
    event = MessageEvent(
        Message(role=Role.ASSISTANT, content="hello"),
        sequence=7,
        message_id="m1",
    )
    frame = event_to_sse_frame(event)
    payload = json.loads(frame[6:-2])
    assert payload["type"] == "message"
    assert payload["sequence"] == 7
    assert payload["message_id"] == "m1"


def test_event_to_sse_frame_serializes_lifecycle_event() -> None:
    event = RunLifecycleEvent(kind="stopped", agent_name="agent", sequence=3, status="completed")
    frame = event_to_sse_frame(event)
    payload = json.loads(frame[6:-2])
    assert payload == {
        "type": "run_lifecycle",
        "payload": {
            "kind": "stopped",
            "agent_name": "agent",
            "sequence": 3,
            "status": "completed",
        },
    }


def test_event_to_sse_frame_serializes_lifecycle_started_with_metadata() -> None:
    event = RunLifecycleEvent(
        kind="started",
        agent_name="root",
        sequence=1,
        api_name="openai",
        model_name="gpt-4",
        max_context_tokens=128_000,
        temperature=0.2,
        output_format="json",
    )
    frame = event_to_sse_frame(event)
    payload = json.loads(frame[6:-2])
    assert payload == {
        "type": "run_lifecycle",
        "payload": {
            "kind": "started",
            "agent_name": "root",
            "sequence": 1,
            "api_name": "openai",
            "model_name": "gpt-4",
            "max_context_tokens": 128_000,
            "temperature": 0.2,
            "output_format": "json",
        },
    }


def test_event_to_sse_frame_serializes_script_output_event() -> None:
    event = ScriptOutputEvent(content="script line", sequence=9)
    frame = event_to_sse_frame(event)
    payload = json.loads(frame[6:-2])
    assert payload == {
        "type": "script_output",
        "sequence": 9,
        "payload": {"content": "script line"},
    }


def test_event_to_sse_frame_serializes_message_delta_event() -> None:
    event = MessageDeltaEvent(
        message_id="m1",
        delta="hel",
        chunk_index=1,
        role=Role.ASSISTANT,
        agent_name="root",
        sequence=7,
    )
    frame = event_to_sse_frame(event)
    payload = json.loads(frame[6:-2])
    assert payload == {
        "type": "message_delta",
        "sequence": 7,
        "payload": {
            "message_id": "m1",
            "delta": "hel",
            "chunk_index": 1,
            "role": "assistant",
            "agent_name": "root",
            "sequence": 7,
        },
    }


def test_event_to_sse_frame_serializes_runtime_event() -> None:
    event = RuntimeEvent(
        category="llm",
        kind="failed",
        level="error",
        message="provider auth error",
        sequence=12,
        agent_name="root",
        data={"error_kind": "auth", "model": "gpt-4.1"},
    )
    frame = event_to_sse_frame(event)
    payload = json.loads(frame[6:-2])
    assert payload == {
        "type": "runtime_event",
        "sequence": 12,
        "payload": {
            "category": "llm",
            "kind": "failed",
            "level": "error",
            "message": "provider auth error",
            "sequence": 12,
            "agent_name": "root",
            "data": {"error_kind": "auth", "model": "gpt-4.1"},
        },
    }
