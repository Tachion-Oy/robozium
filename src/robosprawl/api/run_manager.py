"""Background run of the orchestrator with API user I/O."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Collection
from typing import Final, cast
from uuid import uuid4

from roboz.llm import LLMEndpoint
from roboz.runtime.events import EventSink
from roboz.tooling import LazyExternalDependency

from robosprawl.api.errors import (
    ProjectBusyError,
    ProjectCancellationInProgressError,
)
from robosprawl.api.run_events import RunEvents
from robosprawl.api.run_executor import RunExecutor
from robosprawl.api.state import (
    STATUS_AWAITING_USER_INPUT,
    STATUS_QUEUED,
    ProjectRunItem,
    RunState,
    RunView,
)
from robosprawl.api.wait_registry import WaitRegistry
from robosprawl.orchestrator_factory import OrchestratorFactory
from robosprawl.workspace import Project

logger = logging.getLogger(__name__)
MESSAGE_HISTORY_LIMIT: Final[int] = 5_000
COMPLETED_TTL_S: Final[float] = 300.0


class RunManager:
    """Owns the process-wide run registry and its public control operations."""

    def __init__(
        self,
        root_agent_factory: OrchestratorFactory,
        *,
        hub_name: str,
        default_orchestrator_endpoint: Callable[
            [], LazyExternalDependency[LLMEndpoint]
        ],
        message_history_limit: int | None = None,
        completed_ttl_s: float | None = None,
    ) -> None:
        if not hub_name.strip():
            raise ValueError("hub_name must be non-empty")
        if message_history_limit is None:
            message_history_limit = MESSAGE_HISTORY_LIMIT
        if message_history_limit < 1:
            raise ValueError("message_history_limit must be >= 1")
        if completed_ttl_s is None:
            completed_ttl_s = COMPLETED_TTL_S
        if completed_ttl_s < 0:
            raise ValueError("completed_ttl_s must be >= 0")
        self._factory = root_agent_factory
        self._default_orchestrator_endpoint = default_orchestrator_endpoint
        self._hub_name = hub_name
        self._wait_registry = WaitRegistry()
        self._message_history_limit = message_history_limit
        self._completed_ttl_s = completed_ttl_s
        self._lock = threading.Lock()
        self._runs: dict[str, RunState] = {}
        self._events = RunEvents(
            self._runs,
            self._lock,
            message_history_limit=self._message_history_limit,
        )
        self._executor = RunExecutor(
            self._runs,
            self._lock,
            factory=self._factory,
            wait_registry=self._wait_registry,
            events=self._events,
            hub_name=self._hub_name,
        )

    @property
    def wait_registry(self) -> WaitRegistry:
        return self._wait_registry

    def create(
        self,
        project: Project,
        *,
        background_sync_active: bool = False,
    ) -> str:
        """Allocate a run id/state without starting orchestration."""
        if not project.slug.strip():
            raise ValueError("project slug must be non-empty")
        if self.project_is_cancelling(
            project.slug, background_sync_active=background_sync_active
        ):
            raise ProjectCancellationInProgressError(
                f"cancellation is still in progress for project '{project.slug}'"
            )
        with self._lock:
            for existing_run_id, existing in self._runs.items():
                if existing["project"].slug != project.slug:
                    continue
                if existing["cancel_requested"]:
                    raise ProjectCancellationInProgressError(
                        f"cancellation is still in progress for project '{project.slug}'"
                    )
                if not existing["status"].is_terminal:
                    return existing_run_id

            if background_sync_active:
                raise ProjectBusyError(
                    "background synchronization is still running for project "
                    f"'{project.slug}'"
                )

            run_id = str(uuid4())
            state: RunState = {
                "project": project,
                "orchestrator_endpoint": self._default_orchestrator_endpoint(),
                "status": STATUS_QUEUED,
                "created_at": time.time(),
                "completed_at": None,
                "cancel_requested": False,
                "thread": None,
                "pipe": None,
                "background_pipes": (),
                "event_listeners": [],
                "next_sequence": 1,
                "agent_stack": [],
                "current_agent_name": None,
                "parent_agent_name": None,
                "message_trace": [],
                "current_prompt_id": None,
                "current_prompt": None,
                "error": None,
            }
            self._runs[run_id] = state
        return run_id

    def start_if_needed(self, run_id: str) -> bool:
        return self._executor.start_if_needed(run_id)

    def get_run(self, run_id: str) -> RunState | None:
        with self._lock:
            s = self._runs.get(run_id)
            if s is None:
                return None
            return cast(RunState, dict(s))

    def get_orchestrator_endpoint(
        self, run_id: str
    ) -> LazyExternalDependency[LLMEndpoint]:
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                raise KeyError(f"unknown run_id: {run_id}")
            return state["orchestrator_endpoint"]

    def replace_orchestrator_endpoint(
        self,
        run_id: str,
        endpoint: LazyExternalDependency[LLMEndpoint],
    ) -> None:
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                raise KeyError(f"unknown run_id: {run_id}")
            state["orchestrator_endpoint"] = endpoint

    def run_view(self, run_id: str) -> RunView | None:
        """State safe to return from HTTP (no thread object)."""
        raw = self.get_run(run_id)
        if raw is None:
            return None
        return {
            "project": raw["project"].slug,
            "status": raw["status"],
            "current_agent_name": raw["current_agent_name"],
            "parent_agent_name": raw["parent_agent_name"],
            "message_trace": list(raw["message_trace"]),
            "current_prompt_id": raw["current_prompt_id"],
            "current_prompt": raw["current_prompt"],
            "error": raw["error"],
        }

    def list_project_runs(
        self, *, active_background_sync_projects: Collection[str] = ()
    ) -> list[ProjectRunItem]:
        with self._lock:
            now = time.time()
            out: list[ProjectRunItem] = []
            for run_id, state in list(self._runs.items()):
                completed_at = state["completed_at"]
                if (
                    completed_at is not None
                    and now - completed_at > self._completed_ttl_s
                ):
                    # Keep settled runs while the librarian still drains; syncing
                    # rows need a cancellable background pipe handle.
                    if state["project"].slug in active_background_sync_projects:
                        pass
                    else:
                        del self._runs[run_id]
                        continue
                out.append(
                    {
                        "run_id": run_id,
                        "project": state["project"].slug,
                        "status": state["status"],
                        "created_at": state["created_at"],
                        "current_agent_name": state["current_agent_name"],
                    }
                )
            return out

    def project_is_cancelling(
        self, slug: str, *, background_sync_active: bool = False
    ) -> bool:
        with self._lock:
            states = [
                state
                for state in self._runs.values()
                if state["project"].slug == slug and state["cancel_requested"]
            ]
            if not states:
                return False
            run_active = any(
                (
                    not state["status"].is_terminal
                    or (state["thread"] is not None and state["thread"].is_alive())
                )
                for state in states
            )
        if run_active or background_sync_active:
            return True
        with self._lock:
            for state in self._runs.values():
                if state["project"].slug == slug:
                    state["cancel_requested"] = False
        return False

    def cancel_project(self, slug: str) -> bool:
        """Ensure all active project work is cancelled.

        Cancellation is idempotent: reaching this method with no active work is
        already a successful outcome.
        """
        with self._lock:
            run_ids = []
            background_pipes = []
            for run_id, state in self._runs.items():
                if state["project"].slug != slug:
                    continue
                if not state["status"].is_terminal:
                    state["cancel_requested"] = True
                    run_ids.append(run_id)
                active_background_pipes = [
                    pipe for pipe in state["background_pipes"] if not pipe.cancelled
                ]
                if active_background_pipes:
                    state["cancel_requested"] = True
                    background_pipes.extend(active_background_pipes)
            if not run_ids and not background_pipes:
                return True

        for run_id in run_ids:
            try:
                self._executor.cancel(run_id)
            except KeyError:
                # The run settled between collection and cancellation, so the
                # requested inactive state has already been reached.
                continue
        for pipe in background_pipes:
            pipe.cancel()
        return True

    def subscribe_event_listener(self, run_id: str, event_listener: EventSink) -> None:
        self._events.subscribe(run_id, event_listener)

    def unsubscribe_event_listener(
        self, run_id: str, event_listener: EventSink
    ) -> None:
        self._events.unsubscribe(run_id, event_listener)

    def submit_reply(self, run_id: str, prompt_id: str | None, content: str) -> None:
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            current_prompt_id = state["current_prompt_id"]
            if (
                current_prompt_id is None
                or state["status"] != STATUS_AWAITING_USER_INPUT
            ):
                msg = "run is not currently awaiting user input"
                raise ValueError(msg)

            effective_prompt_id = current_prompt_id if prompt_id is None else prompt_id
            if effective_prompt_id != current_prompt_id:
                msg = "prompt_id does not match the active prompt for this run"
                raise ValueError(msg)

        if not self._wait_registry.resolve(effective_prompt_id, content):
            msg = f"unknown or inactive prompt_id: {prompt_id}"
            raise ValueError(msg)

    def cancel(self, run_id: str) -> bool:
        return self._executor.cancel(run_id)

    def interrupt(self, run_id: str) -> bool:
        return self._executor.interrupt(run_id)

    def project_is_busy(self, slug: str) -> bool:
        """True while any run for ``slug`` still has a live worker thread.

        This is the deletion gate: the project folder is only safe to remove
        once the thread has fully unwound (its ``invoke()`` finalized, files
        flushed), regardless of the recorded status.
        """
        with self._lock:
            return any(
                state["project"].slug == slug
                and state["thread"] is not None
                and state["thread"].is_alive()
                for state in self._runs.values()
            )

    def forget_project_runs(self, slug: str) -> None:
        """Drop a deleted project's settled runs from the registry."""
        with self._lock:
            for run_id in [
                run_id
                for run_id, state in self._runs.items()
                if state["project"].slug == slug
            ]:
                del self._runs[run_id]


__all__ = ["RunManager"]
