"""SSE helpers for adapting pipe events to stream frames."""

import json
from dataclasses import asdict

from roboz.runtime.events import (
    MessageDeltaEvent,
    MessageEvent,
    PipeEvent,
    RunLifecycleEvent,
    RuntimeEvent,
    ScriptOutputEvent,
)


def _drop_none_values(payload: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in payload.items() if value is not None}


def event_to_sse_frame(event: PipeEvent) -> str:
    """Serialize a pipe event into a single SSE data frame."""
    payload: dict[str, object]
    match event:
        case MessageEvent(message=message, sequence=sequence, message_id=message_id):
            payload = {
                "type": "message",
                "sequence": sequence,
                "payload": message.model_dump(mode="json"),
            }
            if message_id is not None:
                payload["message_id"] = message_id
        case RunLifecycleEvent():
            payload = {
                "type": "run_lifecycle",
                "payload": _drop_none_values(asdict(event)),
            }
        case ScriptOutputEvent(content=content, sequence=sequence):
            payload = {
                "type": "script_output",
                "sequence": sequence,
                "payload": {"content": content},
            }
        case MessageDeltaEvent(
            message_id=message_id,
            delta=delta,
            chunk_index=chunk_index,
            role=role,
            agent_name=agent_name,
            sequence=sequence,
        ):
            payload = {
                "type": "message_delta",
                "sequence": sequence,
                "payload": {
                    "message_id": message_id,
                    "delta": delta,
                    "chunk_index": chunk_index,
                    "role": role,
                    "agent_name": agent_name,
                    "sequence": sequence,
                },
            }
        case RuntimeEvent():
            payload = {
                "type": "runtime_event",
                "sequence": event.sequence,
                "payload": _drop_none_values(asdict(event)),
            }
        case _:  # pragma: no cover - protects future event extension.
            payload = {"type": "unknown", "payload": {}}

    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


__all__ = ["event_to_sse_frame"]
