"""Run event dispatch, projection, sequencing, and listener fanout."""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Callable
from copy import deepcopy
from dataclasses import asdict, replace
from threading import RLock
from typing import TypedDict

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
    RunProjection,
    RunViewLifecycleEntry,
    RunViewMessageEntry,
    RunViewMessagePayload,
    RunViewRuntimeEventEntry,
    RunViewScriptOutputEntry,
    TraceEntry,
)

logger = logging.getLogger(__name__)


class _EventState(TypedDict):
    next_sequence: int
    agent_stack: list[str]
    current_agent_name: str | None
    parent_agent_name: str | None
    message_trace: deque[TraceEntry]


class RunEvents:
    """Owns event normalization and replay-listener delivery for run state."""

    def __init__(self, *, message_history_limit: int) -> None:
        self._lock = RLock()
        self._delivery_lock = RLock()
        self._listeners: list[EventSink] = []
        self._state: _EventState = {
            "next_sequence": 1,
            "agent_stack": [],
            "current_agent_name": None,
            "parent_agent_name": None,
            "message_trace": deque(maxlen=message_history_limit),
        }
        self._completion_listeners: dict[EventSink, Callable[[], None]] = {}
        self._completed = False

    @property
    def current_agent_name(self) -> str | None:
        with self._lock:
            return self._state["current_agent_name"]

    def snapshot(self) -> RunProjection:
        with self._lock:
            return {
                **self._state,
                "agent_stack": list(self._state["agent_stack"]),
                "message_trace": list(deepcopy(self._state["message_trace"])),
            }

    def subscribe(
        self, listener: EventSink, on_complete: Callable[[], None] | None = None
    ) -> None:
        with self._delivery_lock:
            with self._lock:
                self._listeners.append(listener)
                if on_complete is not None:
                    self._completion_listeners[listener] = on_complete
                completed = self._completed
            if completed and on_complete is not None:
                on_complete()

    def unsubscribe(self, listener: EventSink) -> None:
        with self._lock:
            if listener in self._listeners:
                self._listeners.remove(listener)
            self._completion_listeners.pop(listener, None)

    def complete(self) -> None:
        with self._delivery_lock:
            with self._lock:
                if self._completed:
                    return
                self._completed = True
                listeners = tuple(self._completion_listeners.values())
            for listener in listeners:
                try:
                    listener()
                except Exception:
                    logger.warning("Completion listener raised", exc_info=True)

    def dispatch(self, event: PipeEvent) -> PipeEvent:
        # Sequencing and fanout share one order, without holding the state lock
        # while calling external listeners (which may read a run snapshot).
        with self._delivery_lock:
            with self._lock:
                event = self._normalize_and_record(self._state, event)
                listeners = tuple(self._listeners)
            for listener in listeners:
                try:
                    listener(event)
                except Exception:
                    logger.warning("Event listener raised", exc_info=True)
        return event

    def _normalize_and_record(
        self, state: _EventState, event: PipeEvent
    ) -> PipeEvent:
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

    def _record_message_event(self, state: _EventState, event: MessageEvent) -> None:
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

    def _record_lifecycle_event(
        self, state: _EventState, event: RunLifecycleEvent
    ) -> None:
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
        self, state: _EventState, event: ScriptOutputEvent
    ) -> None:
        script_entry: RunViewScriptOutputEntry = {
            "type": "script_output",
            "sequence": event.sequence,
            "payload": {"content": event.content},
        }
        self._append_trace_entry(state, script_entry)

    def _record_runtime_event(self, state: _EventState, event: RuntimeEvent) -> None:
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

    def _append_trace_entry(self, state: _EventState, entry: TraceEntry) -> None:
        state["message_trace"].append(entry)

    @staticmethod
    def _next_run_sequence(state: _EventState) -> int:
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
