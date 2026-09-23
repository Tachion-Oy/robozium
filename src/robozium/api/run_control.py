"""Lifecycle and interaction ownership for one host run."""

from __future__ import annotations

import ctypes
import logging
import threading
import time
from collections.abc import Callable
from contextvars import copy_context
from uuid import uuid4

from roboz.agent import Agent
from roboz.llm import LLMEndpoint
from roboz.runtime.events import EventSink, PipeEvent, RunLifecycleEvent
from roboz.runtime.pipe import EventPipe

from robozium.api.projects import Project
from robozium.api.run_events import RunEvents
from robozium.api.state import ProjectRunItem, RunState, RunStatus
from robozium.api.wait_registry import RunCancelled, WaitRegistry

logger = logging.getLogger(__name__)


class RunControl:
    """Serialize control transitions; collaborators receive operations and snapshots."""

    def __init__(
        self,
        project: Project,
        endpoint: LLMEndpoint,
        *,
        history_limit: int,
    ) -> None:
        self._project = project
        self._events = RunEvents(message_history_limit=history_limit)
        self._registry = WaitRegistry()
        self._lock = threading.RLock()
        self._endpoint = endpoint
        self._status = RunStatus.QUEUED
        self._created_at = time.time()
        self._completed_at: float | None = None
        self._cancel_requested = False
        self._cancel_background = False
        self._thread: threading.Thread | None = None
        self._pipe: EventPipe | None = None
        self._background_pipes: tuple[EventPipe, ...] = ()
        self._background_threads: set[threading.Thread] = set()
        self._prompt_id: str | None = None
        self._prompt: str | None = None
        self._error: str | None = None
        self._can_interrupt = False
        self._agent_status: RunStatus | None = None

    @property
    def project(self) -> Project:
        return self._project

    @property
    def model_id(self) -> str:
        with self._lock:
            return self._endpoint.dependency_id

    def endpoint(self) -> LLMEndpoint:
        with self._lock:
            return self._endpoint

    def replace_endpoint(self, endpoint: LLMEndpoint) -> None:
        with self._lock:
            self._endpoint = endpoint

    @property
    def status(self) -> RunStatus:
        with self._lock:
            return self._status

    @property
    def cancel_requested(self) -> bool:
        with self._lock:
            return self._cancel_requested

    def expired(self, ttl_s: float) -> bool:
        with self._lock:
            return (
                self._completed_at is not None
                and time.time() - self._completed_at > ttl_s
            )

    def summary(self, run_id: str) -> ProjectRunItem:
        with self._lock:
            return {
                "run_id": run_id,
                "project": self.project.slug,
                "status": self._status,
                "created_at": self._created_at,
                "current_agent_name": self._events.current_agent_name,
            }

    def snapshot(self) -> RunState:
        with self._lock:
            state: RunState = {
                "project": self.project.slug,
                "model_id": self._endpoint.dependency_id,
                "status": self._status,
                "created_at": self._created_at,
                "completed_at": self._completed_at,
                "cancel_requested": self._cancel_requested,
                "worker_alive": self._thread is not None and self._thread.is_alive(),
                "background_active": self.is_busy(background_only=True),
                "current_prompt_id": self._prompt_id,
                "current_prompt": self._prompt,
                "error": self._error,
                **self._events.snapshot(),
            }
            return state

    def launch_worker(self, work: Callable[[], None], *, thread_name: str) -> bool:
        """Launch and track the work in a thread with the caller's copied context.

        Return False if this run already launched, was cancelled, or has finished.
        """
        failure = None
        with self._lock:
            if (
                self._thread is not None
                or self._cancel_requested
                or self._status.is_terminal
            ):
                return False
            try:
                context = copy_context()
                thread = threading.Thread(
                    target=context.run, args=(work,), daemon=True, name=thread_name
                )
                self._thread = thread
                # Publish a live worker before releasing the lock used by deletion.
                thread.start()
            except Exception as exc:
                self._thread = None
                self._finish_locked(RunStatus.FAILED, error=str(exc))
                failure = exc
        if failure is not None:
            self._events.complete()
            raise failure
        return True

    def attach(self, agents: tuple[Agent, tuple[Agent, ...]]) -> bool:
        agent, background_agents = agents
        with self._lock:
            self._pipe = agent.pipe
            self._background_pipes = tuple(
                background.pipe for background in background_agents
            )
            for pipe in self._background_pipes:
                pipe.add_sink(self._background_observer(pipe))
            if self._cancel_requested:
                return False
            self._status = RunStatus.RUNNING
            return True

    def _background_observer(self, pipe: EventPipe) -> EventSink:
        def observe(event: PipeEvent) -> None:
            if isinstance(event, RunLifecycleEvent) and event.kind == "started":
                with self._lock:
                    self._background_threads.add(threading.current_thread())
                    cancelled = self._cancel_background
                # initialize() resets the pipe: reapply a host cancellation.
                if cancelled:
                    pipe.cancel()

        return observe

    def dispatch(self, event: PipeEvent) -> None:
        with self._lock:
            if isinstance(event, RunLifecycleEvent) and event.parent_agent_name is None:
                if event.kind == "started":
                    if self._cancel_requested and self._pipe is not None:
                        self._pipe.cancel()
                elif event.kind == "stopped":
                    self._can_interrupt = False
                    if event.status is not None:
                        self._agent_status = RunStatus(event.status)
            elif self._pipe is not None and self._agent_status is None:
                self._can_interrupt = True
        self._events.dispatch(event)

    def finish(self, status: RunStatus, *, error: str | None = None) -> None:
        with self._lock:
            changed = self._finish_locked(status, error=error)
        if changed:
            self._events.complete()

    def _finish_locked(self, status: RunStatus, *, error: str | None) -> bool:
        """Record a terminal outcome while holding the lifecycle lock."""
        if self._status.is_terminal:
            return False
        self._status = (
            RunStatus.CANCELLED
            if self._cancel_requested
            else status
            if status == RunStatus.FAILED
            else self._agent_status or status
        )
        self._completed_at = time.time()
        self._error = error if self._status == RunStatus.FAILED else None
        self._pipe = None
        self._can_interrupt = False
        return True

    def request_input(self, message: str, timeout: float | None = None) -> str | None:
        prompt_id = str(uuid4())
        with self._lock:
            if self._cancel_requested or self._status.is_terminal:
                raise RunCancelled("run cancelled before user input")
            self._registry.register(prompt_id)
            self._prompt_id, self._prompt = prompt_id, message
            self._status = RunStatus.AWAITING_USER_INPUT
        try:
            return self._registry.wait(prompt_id, timeout_s=timeout)
        except TimeoutError:
            return None
        finally:
            with self._lock:
                self._registry.discard(prompt_id)
                self._prompt_id = self._prompt = None
                if self._status == RunStatus.AWAITING_USER_INPUT:
                    self._status = RunStatus.RUNNING

    def submit_reply(self, prompt_id: str | None, content: str) -> None:
        with self._lock:
            if self._status != RunStatus.AWAITING_USER_INPUT or self._prompt_id is None:
                raise ValueError("run is not currently awaiting user input")
            if prompt_id is not None and prompt_id != self._prompt_id:
                raise ValueError(
                    "prompt_id does not match the active prompt for this run"
                )
            if not self._registry.resolve(self._prompt_id, content):
                raise ValueError(f"unknown or inactive prompt_id: {prompt_id}")

    def cancel(self, *, background: bool = False) -> bool:
        queued = False
        thread = None
        with self._lock:
            pipes = self._background_pipes if background else ()
            if background:
                self._cancel_background = True
            if self._status.is_terminal:
                if pipes:
                    self._cancel_requested = True
                accepted = background
            elif self._status == RunStatus.CANCELLING:
                accepted = True
            else:
                self._cancel_requested = True
                self._status = RunStatus.CANCELLING
                accepted = True
                queued = self._thread is None
                if self._pipe is not None:
                    pipes = (*pipes, self._pipe)
                if self._prompt_id is not None:
                    self._registry.cancel(self._prompt_id)
                elif self._can_interrupt:
                    thread = self._thread
        # Pipe cancellation may execute provider callbacks. Keep these and
        # subscriber notifications outside the lifecycle lock.
        for pipe in pipes:
            pipe.cancel()
        if queued:
            self.finish(RunStatus.CANCELLED)
        elif thread is not None:
            self._interrupt_thread(thread)
        return accepted

    def interrupt(self) -> bool:
        with self._lock:
            if (
                self._status != RunStatus.RUNNING
                or not self._can_interrupt
                or self._pipe is None
                or self._thread is None
                or self._pipe.interrupted
            ):
                return False
            pipe, thread = self._pipe, self._thread
        pipe.interrupt()
        self._interrupt_thread(thread)
        return True

    @staticmethod
    def _interrupt_thread(thread: threading.Thread) -> None:
        """Asynchronously raise ``KeyboardInterrupt`` inside ``thread``."""
        ident = thread.ident
        if ident is None or not thread.is_alive():
            logger.debug(
                "Skip thread interrupt: not alive (thread=%s ident=%s)",
                thread.name,
                ident,
            )
            return
        logger.debug(
            "Injecting KeyboardInterrupt (thread=%s ident=%s)", thread.name, ident
        )
        affected = ctypes.pythonapi.PyThreadState_SetAsyncExc(
            ctypes.c_ulong(ident), ctypes.py_object(KeyboardInterrupt)
        )
        if affected > 1:
            logger.warning(
                "Thread interrupt affected %d threads; reverting, interrupt lost "
                "(thread=%s ident=%s)",
                affected,
                thread.name,
                ident,
            )
            ctypes.pythonapi.PyThreadState_SetAsyncExc(ctypes.c_ulong(ident), None)

    def is_busy(self, *, background_only: bool = False) -> bool:
        with self._lock:
            threads = set(self._background_threads)
            if not background_only and self._thread is not None:
                threads.add(self._thread)
            return any(thread.is_alive() for thread in threads)

    def is_cancelling(self, *, background_active: bool = False) -> bool:
        with self._lock:
            if not self._cancel_requested:
                return False
            if not self._status.is_terminal or self.is_busy() or background_active:
                return True
            self._cancel_requested = False
            return False

    def join(self, deadline: float) -> bool:
        with self._lock:
            thread = self._thread
        if thread is not None:
            thread.join(max(0.0, deadline - time.monotonic()))
        # The root can start background work while it unwinds.
        with self._lock:
            background = tuple(self._background_threads)
        for thread in background:
            thread.join(max(0.0, deadline - time.monotonic()))
        return not self.is_busy()

    def subscribe(
        self, listener: EventSink, on_complete: Callable[[], None] | None = None
    ) -> None:
        self._events.subscribe(listener, on_complete)

    def unsubscribe(self, listener: EventSink) -> None:
        self._events.unsubscribe(listener)
