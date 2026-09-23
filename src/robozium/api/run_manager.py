"""Registry and public control facade for host runs."""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Callable, Collection
from functools import partial
from uuid import uuid4

from roboz.agent import Agent
from roboz.llm import LLMEndpoint
from roboz.runtime import bind_api_user_io, reset_api_user_io
from roboz.runtime.events import EventSink

from robozium.api.errors import ProjectBusyError, ProjectCancellationInProgressError
from robozium.api.projects import Project
from robozium.api.run_control import RunControl
from robozium.api.state import ProjectRunItem, RunState, RunStatus, RunView
from robozium.api.user_io import ApiUserIO

logger = logging.getLogger(__name__)
MESSAGE_HISTORY_LIMIT = 5_000
COMPLETED_TTL_S = 300.0


class RunManager:
    def __init__(
        self,
        configure_deployment: Callable[..., tuple[Agent, tuple[Agent, ...]]],
        *,
        hub_name: str,
        default_orchestrator_endpoint: Callable[[], LLMEndpoint],
        message_history_limit: int | None = None,
        completed_ttl_s: float | None = None,
    ) -> None:
        if not hub_name.strip():
            raise ValueError("hub_name must be non-empty")
        self._history_limit = (
            MESSAGE_HISTORY_LIMIT
            if message_history_limit is None
            else message_history_limit
        )
        self._ttl = COMPLETED_TTL_S if completed_ttl_s is None else completed_ttl_s
        if self._history_limit < 1:
            raise ValueError("message_history_limit must be >= 1")
        if self._ttl < 0:
            raise ValueError("completed_ttl_s must be >= 0")
        self._default_endpoint = default_orchestrator_endpoint
        self._hub_name = hub_name
        self._lock = threading.RLock()
        self._runs: dict[str, RunControl] = {}
        self._closed = False
        self._configure_deployment = configure_deployment

    def _control(self, run_id: str) -> RunControl:
        with self._lock:
            try:
                return self._runs[run_id]
            except KeyError:
                raise KeyError(f"unknown run_id: {run_id}") from None

    def create(self, project: Project, *, background_sync_active: bool = False) -> str:
        if not project.slug.strip():
            raise ValueError("project slug must be non-empty")
        with self._lock:
            if self._closed:
                raise ProjectBusyError("application is shutting down")
            if self.project_is_cancelling(
                project.slug, background_sync_active=background_sync_active
            ):
                raise ProjectCancellationInProgressError(
                    f"cancellation is still in progress for project '{project.slug}'"
                )
            for run_id, control in self._runs.items():
                if (
                    control.project.slug == project.slug
                    and not control.status.is_terminal
                ):
                    return run_id
            if background_sync_active or self.project_is_busy(project.slug):
                raise ProjectBusyError(
                    f"background synchronization is still running for project '{project.slug}'"
                )
            run_id = str(uuid4())
            self._runs[run_id] = RunControl(
                project,
                self._default_endpoint(),
                history_limit=self._history_limit,
            )
            return run_id

    def start_run(self, run_id: str) -> bool:
        """Resolve a run and coordinate its launch with deletion and shutdown.

        Return True only for a new worker launch; repeated starts are no-ops.
        """
        with self._lock:
            if self._closed:
                return False
            control = self._control(run_id)
            return control.launch_worker(
                partial(
                    self._run_agent,
                    run_id,
                    control,
                    configure=self._configure_deployment,
                ),
                thread_name=f"{self._hub_name}-run-{run_id[:8]}",
            )

    @staticmethod
    def _run_agent(
        run_id: str,
        control: RunControl,
        *,
        configure: Callable[..., tuple[Agent, tuple[Agent, ...]]],
    ) -> None:
        """Worker body: bind API context, construct and invoke the agent.

        Report outcomes through the control without accessing manager state.
        """
        token = bind_api_user_io(ApiUserIO(control))
        try:
            if control.cancel_requested:
                control.finish(RunStatus.CANCELLED)
                return
            agents = configure(
                control.project.sandbox,
                control.project.slug,
                endpoint_getter=control.endpoint,
                event_sinks=(control.dispatch,),
            )
            if control.attach(agents):
                agents[0].invoke()
            control.finish(RunStatus.COMPLETED)
        except KeyboardInterrupt:
            control.finish(RunStatus.CANCELLED)
        except Exception as exc:
            if not control.cancel_requested:
                logger.exception("Hub run failed: run=%s", run_id)
            control.finish(RunStatus.FAILED, error=str(exc))
        finally:
            reset_api_user_io(token)

    def get_run(self, run_id: str) -> RunState | None:
        with self._lock:
            control = self._runs.get(run_id)
        return control.snapshot() if control is not None else None

    def get_orchestrator_model_id(self, run_id: str) -> str:
        return self._control(run_id).model_id

    def replace_orchestrator_endpoint(self, run_id: str, endpoint: LLMEndpoint) -> None:
        self._control(run_id).replace_endpoint(endpoint)

    def run_view(self, run_id: str) -> RunView | None:
        raw = self.get_run(run_id)
        if raw is None:
            return None
        return {
            "project": raw["project"],
            "status": raw["status"],
            "current_agent_name": raw["current_agent_name"],
            "parent_agent_name": raw["parent_agent_name"],
            "message_trace": raw["message_trace"],
            "current_prompt_id": raw["current_prompt_id"],
            "current_prompt": raw["current_prompt"],
            "error": raw["error"],
        }

    def list_project_runs(
        self, *, active_background_sync_projects: Collection[str] = ()
    ) -> list[ProjectRunItem]:
        with self._lock:
            out: list[ProjectRunItem] = []
            for run_id, control in list(self._runs.items()):
                if (
                    control.expired(self._ttl)
                    and control.project.slug not in active_background_sync_projects
                    and not control.is_busy()
                ):
                    del self._runs[run_id]
                    continue
                out.append(control.summary(run_id))
            return out

    def project_is_cancelling(
        self, slug: str, *, background_sync_active: bool = False
    ) -> bool:
        with self._lock:
            return any(
                control.is_cancelling(background_active=background_sync_active)
                for control in self._runs.values()
                if control.project.slug == slug
            )

    def cancel_runs_for_project(self, slug: str) -> bool:
        """Ask each registered run for this project to cancel all its work."""
        with self._lock:
            controls = [
                control
                for control in self._runs.values()
                if control.project.slug == slug
            ]
        for control in controls:
            control.cancel(background=True)
        return True

    def subscribe_event_listener(
        self,
        run_id: str,
        event_listener: EventSink,
        on_complete: Callable[[], None] | None = None,
    ) -> None:
        self._control(run_id).subscribe(event_listener, on_complete)

    def unsubscribe_event_listener(
        self, run_id: str, event_listener: EventSink
    ) -> None:
        with self._lock:
            control = self._runs.get(run_id)
        if control is not None:
            control.unsubscribe(event_listener)

    def submit_reply(self, run_id: str, prompt_id: str | None, content: str) -> None:
        self._control(run_id).submit_reply(prompt_id, content)

    def cancel(self, run_id: str) -> bool:
        return self._control(run_id).cancel()

    def interrupt(self, run_id: str) -> bool:
        return self._control(run_id).interrupt()

    def project_is_busy(self, slug: str, *, background_only: bool = False) -> bool:
        with self._lock:
            return any(
                control.is_busy(background_only=background_only)
                for control in self._runs.values()
                if control.project.slug == slug
            )

    def forget_project_runs(self, slug: str) -> None:
        with self._lock:
            if self.project_is_busy(slug):
                raise ProjectBusyError("project still has active work")
            for run_id in [
                rid
                for rid, control in self._runs.items()
                if control.project.slug == slug
            ]:
                del self._runs[run_id]

    def delete_project(self, slug: str, remove: Callable[[], None]) -> None:
        """Keep registry start/create operations outside the deletion transaction."""
        with self._lock:
            if self.project_is_busy(slug):
                raise ProjectBusyError("project has an active run; cancel it first")
            remove()
            self.forget_project_runs(slug)

    def shutdown(self, timeout_s: float = 10.0) -> bool:
        with self._lock:
            self._closed = True
            controls = tuple(self._runs.values())
        deadline = time.monotonic() + timeout_s
        for control in controls:
            control.cancel(background=True)
        drained = [control.join(deadline) for control in controls]
        if not all(drained):
            logger.error("Run shutdown timed out; some workers are still active")
        return all(drained)
