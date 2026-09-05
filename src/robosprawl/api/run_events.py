"""Run event dispatch, projection, sequencing, and listener fanout."""

from __future__ import annotations

import logging
from dataclasses import asdict, replace
from threading import Lock

from roboz.runtime.events import (
    EventSink,
    MessageDeltaEvent,
    MessageEvent,
    PipeEvent,
    RunLifecycleEvent,
    RuntimeEvent,
    ScriptOutputEvent,
)

from robosprawl.api.state import (
    RunState,
    RunViewLifecycleEntry,
    RunViewMessageEntry,
    RunViewMessagePayload,
    RunViewRuntimeEventEntry,
    RunViewScriptOutputEntry,
    TraceEntry,
)

logger = logging.getLogger(__name__)


class RunEvents:
    """Owns event normalization and replay-listener delivery for run state."""

    def __init__(
        self, runs: dict[str, RunState], lock: Lock, *, message_history_limit: int
    ) -> None:
        self._runs = runs
        self._lock = lock
        self._message_history_limit = message_history_limit

    def sink(self, run_id: str) -> EventSink:
        """Return an event sink bound to ``run_id``."""

        def run_event_sink(event: PipeEvent) -> None:
            self.dispatch(run_id, event)

        return run_event_sink

    def subscribe(self, run_id: str, event_listener: EventSink) -> None:
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            state["event_listeners"].append(event_listener)

    def unsubscribe(self, run_id: str, event_listener: EventSink) -> None:
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                return
            try:
                state["event_listeners"].remove(event_listener)
            except ValueError:
                pass

    def dispatch(self, run_id: str, event: PipeEvent) -> PipeEvent:
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            event = self._normalize_and_record(state, event)
            event_listeners = list(state["event_listeners"])

        logger.debug(
            "Dispatch event (run_id=%s type=%s sequence=%s listeners=%d)",
            run_id,
            type(event).__name__,
            getattr(event, "sequence", None),
            len(event_listeners),
        )
        for event_listener in event_listeners:
            try:
                event_listener(event)
            except Exception:
                # A listener failing (e.g. a full/dead SSE queue) must not stop
                # delivery to the others, and the failure must not be silent.
                logger.warning(
                    "Event listener raised (run_id=%s type=%s listener=%r)",
                    run_id,
                    type(event).__name__,
                    event_listener,
                    exc_info=True,
                )
        return event

    def _normalize_and_record(self, state: RunState, event: PipeEvent) -> PipeEvent:
        sequence = self._next_run_sequence(state)
        match event:
            case MessageDeltaEvent():
                return replace(event, sequence=sequence)
            case MessageEvent():
                normalized = replace(event, sequence=sequence)
                self._record_message_event(state, normalized)
                return normalized
            case RunLifecycleEvent():
                normalized = replace(event, sequence=sequence)
                self._record_lifecycle_event(state, normalized)
                return normalized
            case ScriptOutputEvent():
                normalized = replace(event, sequence=sequence)
                self._record_script_output_event(state, normalized)
                return normalized
            case RuntimeEvent():
                normalized = replace(event, sequence=sequence)
                self._record_runtime_event(state, normalized)
                return normalized
            case _:
                return event

    def _record_message_event(self, state: RunState, event: MessageEvent) -> None:
        payload: RunViewMessagePayload = {
            "role": event.message.role,
            "content": event.message.content,
            "truncation": None,
            "message_kind": event.message.message_kind,
        }
        message_entry: RunViewMessageEntry = {
            "type": "message",
            "sequence": event.sequence,
            "payload": payload,
        }
        self._append_trace_entry(state, message_entry)

    def _record_lifecycle_event(self, state: RunState, event: RunLifecycleEvent) -> None:
        stack = state["agent_stack"]
        match event:
            case RunLifecycleEvent(kind="started", agent_name=agent_name):
                stack.append(agent_name)
            case RunLifecycleEvent(kind="stopped", agent_name=agent_name):
                if not stack:
                    raise RuntimeError("lifecycle stop received with empty agent stack")
                if stack[-1] != agent_name:
                    raise RuntimeError(
                        "lifecycle stop order mismatch: "
                        f"expected {stack[-1]!r}, got {agent_name!r}"
                    )
                stack.pop()

        state["current_agent_name"] = stack[-1] if stack else None
        state["parent_agent_name"] = stack[-2] if len(stack) >= 2 else None

        lifecycle_entry: RunViewLifecycleEntry = {
            "type": "run_lifecycle",
            "payload": asdict(event),
        }
        self._append_trace_entry(state, lifecycle_entry)

    def _record_script_output_event(
        self, state: RunState, event: ScriptOutputEvent
    ) -> None:
        script_entry: RunViewScriptOutputEntry = {
            "type": "script_output",
            "sequence": event.sequence,
            "payload": {"content": event.content},
        }
        self._append_trace_entry(state, script_entry)

    def _record_runtime_event(self, state: RunState, event: RuntimeEvent) -> None:
        runtime_entry: RunViewRuntimeEventEntry = {
            "type": "runtime_event",
            "sequence": event.sequence,
            "payload": {
                "category": event.category,
                "kind": event.kind,
                "level": event.level,
                "message": event.message,
                "agent_name": event.agent_name,
                "data": event.data,
            },
        }
        self._append_trace_entry(state, runtime_entry)

    def _append_trace_entry(self, state: RunState, entry: TraceEntry) -> None:
        next_trace = [*state["message_trace"], entry]
        state["message_trace"] = next_trace[-self._message_history_limit :]

    @staticmethod
    def _next_run_sequence(state: RunState) -> int:
        """Allocate one sequence space for the hub run trace.

        Each agent has its own ``EventPipe`` sequence counter, and a hub run can
        include root-agent, sub-agent, and generic host-notification events. The
        manager is the shared boundary that gives the combined replay/SSE stream
        a single ordering namespace.
        """
        sequence = state["next_sequence"]
        state["next_sequence"] = sequence + 1
        return sequence


__all__ = ["RunEvents"]
