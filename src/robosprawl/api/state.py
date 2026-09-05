"""Shared run-state types and constants for the API runtime."""

from __future__ import annotations

from enum import StrEnum
from threading import Thread
from typing import Any, Literal, TypedDict

from roboz.llm import LLMEndpoint
from roboz.models import MessageKind, Role
from roboz.runtime.events import EventSink
from roboz.runtime.observability import RuntimeEventLevel
from roboz.runtime.pipe import EventPipe
from roboz.tooling import LazyExternalDependency

from robosprawl.composition import RootAgentBundle as RootAgentBundle  # noqa: PLC0414
from robosprawl.workspace import Project


class RunStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    AWAITING_USER_INPUT = "awaiting_user_input"
    CANCELLING = "cancelling"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def is_terminal(self) -> bool:
        return self in {RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED}


class RunLifecycleKind(StrEnum):
    STARTED = "started"
    STOPPED = "stopped"


STATUS_QUEUED: RunStatus = RunStatus.QUEUED
STATUS_RUNNING: RunStatus = RunStatus.RUNNING
STATUS_AWAITING_USER_INPUT: RunStatus = RunStatus.AWAITING_USER_INPUT
STATUS_CANCELLING: RunStatus = RunStatus.CANCELLING
STATUS_COMPLETED: RunStatus = RunStatus.COMPLETED
STATUS_FAILED: RunStatus = RunStatus.FAILED
STATUS_CANCELLED: RunStatus = RunStatus.CANCELLED


class RunViewMessagePayload(TypedDict):
    role: Role
    content: str
    truncation: None
    message_kind: MessageKind | None


class RunViewMessageEntry(TypedDict):
    type: Literal["message"]
    sequence: int
    payload: RunViewMessagePayload


class RunViewLifecycleEntry(TypedDict):
    type: Literal["run_lifecycle"]
    payload: dict[str, Any]


class RunViewScriptOutputPayload(TypedDict):
    content: str


class RunViewScriptOutputEntry(TypedDict):
    type: Literal["script_output"]
    sequence: int
    payload: RunViewScriptOutputPayload


class RunViewRuntimeEventPayload(TypedDict):
    category: str
    kind: str
    level: RuntimeEventLevel | Literal["debug", "info", "warning", "error"]
    message: str
    agent_name: str
    data: dict[str, Any] | None


class RunViewRuntimeEventEntry(TypedDict):
    type: Literal["runtime_event"]
    sequence: int
    payload: RunViewRuntimeEventPayload


TraceEntry = (
    RunViewMessageEntry
    | RunViewLifecycleEntry
    | RunViewScriptOutputEntry
    | RunViewRuntimeEventEntry
)


class RunState(TypedDict):
    project: Project
    orchestrator_endpoint: LazyExternalDependency[LLMEndpoint]
    status: RunStatus
    created_at: float
    completed_at: float | None
    cancel_requested: bool
    thread: Thread | None
    pipe: EventPipe | None
    background_pipes: tuple[EventPipe, ...]
    event_listeners: list[EventSink]
    next_sequence: int
    agent_stack: list[str]
    current_agent_name: str | None
    parent_agent_name: str | None
    message_trace: list[TraceEntry]
    current_prompt_id: str | None
    current_prompt: str | None
    error: str | None


class RunView(TypedDict):
    project: str
    status: RunStatus
    current_agent_name: str | None
    parent_agent_name: str | None
    message_trace: list[TraceEntry]
    current_prompt_id: str | None
    current_prompt: str | None
    error: str | None


class ProjectRunItem(TypedDict):
    run_id: str
    project: str
    status: RunStatus
    created_at: float
    current_agent_name: str | None
