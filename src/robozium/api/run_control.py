"""Lifecycle and interaction ownership for one host run."""

from __future__ import annotations

import ctypes
import logging
import threading
import time
from collections.abc import Callable
from contextvars import copy_context
from types import MappingProxyType
from uuid import uuid4

from roboz.agent import Agent, get_active_agent_stack
from roboz.deployment import DeployableAgent
from roboz.llm import EndpointLike, LLMEndpoint, resolve_endpoint
from roboz.models import Str, StrImage
from roboz.runtime.events import (
    EventSink,
    MessageEvent,
    PipeEvent,
    RunLifecycleEvent,
)
from roboz.runtime.pipe import EventPipe

from robozium.api.attachments import AttachmentStore, ImagesNotSupported, UploadedImage
from robozium.api.history import text_event
from robozium.api.projects import Project
from robozium.api.run_events import RunEvents
from robozium.api.state import CapabilitySelection, ProjectRunItem, RunState, RunStatus
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
        capabilities: CapabilitySelection | None = None,
        run_id: str | None = None,
    ) -> None:
        self._project = project
        self._capabilities: CapabilitySelection = MappingProxyType(
            dict(capabilities or {})
        )
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
        self._attachments = AttachmentStore(project, run_id or str(uuid4()))
        self._attachment_cleanup_started = False
        self._has_images = False
        self._agent_endpoints: dict[str, EndpointLike | None] = {}
        self._prompt_agent: str | None = None
        self._prompt_allows_images = False

    def bind_definition(self, definition: DeployableAgent) -> None:
        """Capture foreground receiving routes before any agent can prompt."""
        pending = [definition]
        endpoints: dict[str, EndpointLike | None] = {}
        while pending:
            node = pending.pop()
            if node.name in endpoints:
                # build() reports invalid graphs; do not loop on a cycle here.
                continue
            endpoints[node.name] = node.agent_endpoint
            pending.extend(node.nested_agents)
        with self._lock:
            self._agent_endpoints = endpoints

    def _prompt_accepts_images(self) -> bool:
        endpoint = self._agent_endpoints.get(self._prompt_agent or "")
        return (
            self._prompt_id is not None
            and self._prompt_allows_images
            and endpoint is not None
            and resolve_endpoint(endpoint).accepts_images
        )

    @property
    def capabilities(self) -> CapabilitySelection:
        return self._capabilities

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
            if self._has_images and not endpoint.accepts_images:
                raise ImagesNotSupported("This run has accepted images; select an image-capable model")
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
            }

    def snapshot(self) -> RunState:
        with self._lock:
            state: RunState = {
                "project": self.project.slug,
                "model_id": self._endpoint.dependency_id,
                "capabilities": dict(self.capabilities),
                "status": self._status,
                "created_at": self._created_at,
                "completed_at": self._completed_at,
                "cancel_requested": self._cancel_requested,
                "worker_alive": self._thread is not None and self._thread.is_alive(),
                "background_active": self.is_busy(background_only=True),
                "current_prompt_id": self._prompt_id,
                "current_prompt": self._prompt,
                "current_prompt_accepts_images": self._prompt_accepts_images(),
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
            self._attachments.cleanup()
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
            if isinstance(event, MessageEvent) and event.message.images:
                self._has_images = True
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
        self._events.dispatch(text_event(event))

    def finish(self, status: RunStatus, *, error: str | None = None) -> None:
        with self._lock:
            changed = self._finish_locked(status, error=error)
        if changed:
            self._events.complete()
            if self._thread is None:
                self._attachments.cleanup()

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

    def request_input(
        self,
        message: str,
        timeout: float | None = None,
        *,
        accepts_images: bool = False,
    ) -> Str | StrImage | None:
        prompt_id = str(uuid4())
        with self._lock:
            if self._cancel_requested or self._status.is_terminal:
                raise RunCancelled("run cancelled before user input")
            self._registry.register(prompt_id)
            self._prompt_id, self._prompt = prompt_id, message
            stack = get_active_agent_stack()
            self._prompt_agent = stack[-1] if stack else None
            self._prompt_allows_images = accepts_images
            self._status = RunStatus.AWAITING_USER_INPUT
        try:
            return self._registry.wait(prompt_id, timeout_s=timeout)
        except TimeoutError:
            return None
        finally:
            with self._lock:
                self._registry.discard(prompt_id)
                self._prompt_id = self._prompt = None
                self._prompt_agent = None
                self._prompt_allows_images = False
                if self._status == RunStatus.AWAITING_USER_INPUT:
                    self._status = RunStatus.RUNNING

    def _validate_reply(self, prompt_id: str | None, *, images: bool) -> None:
        if self._status != RunStatus.AWAITING_USER_INPUT or self._prompt_id is None:
            raise ValueError("run is not currently awaiting user input")
        if prompt_id is not None and prompt_id != self._prompt_id:
            raise ValueError("prompt_id does not match the active prompt for this run")
        if images and not self._prompt_accepts_images():
            raise ImagesNotSupported("The current prompt or receiving model does not accept images")

    def validate_image_reply(self, prompt_id: str) -> None:
        with self._lock:
            self._validate_reply(prompt_id, images=True)

    def submit_reply(self, prompt_id: str | None, content: Str | StrImage) -> None:
        with self._lock:
            images = isinstance(content, StrImage) and bool(content.images)
            self._validate_reply(prompt_id, images=images)
            assert self._prompt_id is not None
            if not self._registry.resolve(self._prompt_id, content):
                raise ValueError(f"unknown or inactive prompt_id: {prompt_id}")
            self._has_images |= images

    def submit_images(
        self, prompt_id: str, content: str, images: list[UploadedImage]
    ) -> None:
        with self._lock:
            self._validate_reply(prompt_id, images=True)
            if not self._attachment_cleanup_started:
                # Only runs that stage uploads need an automatic cleanup waiter.
                # Shutdown uses the same worker-waiting and cleanup operation.
                threading.Thread(
                    target=self.join,
                    daemon=True,
                    name=f"{self._attachments.root.name}-attachments",
                ).start()
                self._attachment_cleanup_started = True
        staged = self._attachments.stage(content, images)
        try:
            # Model changes, expiry, cancellation, and competing replies all
            # recheck here under the same lock as text replies and model changes.
            self.submit_reply(prompt_id, staged.reply)
        except BaseException:
            self._attachments.discard(staged)
            raise

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

    def join(self, deadline: float | None = None) -> bool:
        while True:
            with self._lock:
                threads = set(self._background_threads)
                if self._thread is not None:
                    threads.add(self._thread)
            for thread in threads:
                thread.join(
                    None if deadline is None else max(0.0, deadline - time.monotonic())
                )
            if not self.is_busy():
                self._attachments.cleanup()
                return True
            if deadline is not None and time.monotonic() >= deadline:
                return False
            # Workers may have started more background work while unwinding.

    def subscribe(
        self, listener: EventSink, on_complete: Callable[[], None] | None = None
    ) -> None:
        self._events.subscribe(listener, on_complete)

    def unsubscribe(self, listener: EventSink) -> None:
        self._events.unsubscribe(listener)
