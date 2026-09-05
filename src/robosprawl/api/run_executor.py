"""Active run lifecycle: start, invoke, finalize, cancel, and interrupt."""

from __future__ import annotations

import ctypes
import logging
import threading
import time
from contextvars import copy_context
from threading import Lock

from roboz.runtime import (
    Output,
    bind_api_user_io,
    bind_output,
    log_with_data,
    reset_api_user_io,
    reset_output,
)
from roboz.runtime.events import EventSink
from roboz.runtime.pipe import EventPipe

from robosprawl.api.run_events import RunEvents
from robosprawl.api.state import (
    STATUS_AWAITING_USER_INPUT,
    STATUS_CANCELLED,
    STATUS_CANCELLING,
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_RUNNING,
    RunState,
    RunStatus,
)
from robosprawl.api.user_io import ApiUserIO
from robosprawl.api.wait_registry import WaitRegistry
from robosprawl.orchestrator_factory import OrchestratorFactory

logger = logging.getLogger(__name__)


class RunExecutor:
    """Executes and controls worker threads for the shared run registry."""

    def __init__(
        self,
        runs: dict[str, RunState],
        lock: Lock,
        *,
        factory: OrchestratorFactory,
        wait_registry: WaitRegistry,
        events: RunEvents,
        hub_name: str,
    ) -> None:
        self._runs = runs
        self._lock = lock
        self._factory = factory
        self._wait_registry = wait_registry
        self._events = events
        self._hub_name = hub_name

    def start_if_needed(self, run_id: str) -> bool:
        """Start an existing run once; return True only when started now."""
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            if state["thread"] is not None:
                logger.debug("start_if_needed: already started (run_id=%s)", run_id)
                return False
            if state["cancel_requested"] or state["status"].is_terminal:
                logger.debug(
                    "start_if_needed: not startable (run_id=%s status=%s)",
                    run_id,
                    state["status"].value,
                )
                return False

            run_event_sink = self._events.sink(run_id)
            user_io = ApiUserIO(self._wait_registry, state, self._lock, run_event_sink)
            ctx = copy_context()
            thread = threading.Thread(
                target=ctx.run,
                args=(self._run_root_agent, run_id, user_io, run_event_sink),
                daemon=True,
                name=f"{self._hub_name}-run-{run_id[:8]}",
            )
            state["thread"] = thread

        logger.debug("Starting run (run_id=%s thread=%s)", run_id, thread.name)
        thread.start()
        return True

    def _run_root_agent(
        self, run_id: str, user_io: ApiUserIO, run_event_sink: EventSink
    ) -> None:
        token = bind_api_user_io(user_io)
        output_token = bind_output(Output.API)
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            project = state["project"]

        def orchestrator_endpoint():
            with self._lock:
                return state["orchestrator_endpoint"]

        log_with_data(
            logger,
            logging.INFO,
            f"Hub run started: run={run_id[:8]}, project={project.slug}",
            {"run_id": run_id, "project": project.slug},
        )
        try:
            bundle = self._factory(
                project,
                endpoint_getter=orchestrator_endpoint,
                event_sinks=(run_event_sink,),
            )
            root_agent = bundle.agent
            background_pipes = tuple(agent.pipe for agent in bundle.background_agents)
            with self._lock:
                refreshed = self._runs.get(run_id)
                if refreshed is None:
                    msg = f"unknown run_id: {run_id}"
                    raise KeyError(msg)
                refreshed["pipe"] = root_agent.pipe
                refreshed["background_pipes"] = background_pipes
                refreshed["status"] = STATUS_RUNNING
            root_agent.invoke()
            log_with_data(
                logger,
                logging.INFO,
                f"Hub run succeeded: run={run_id[:8]}",
                {"run_id": run_id, "status": STATUS_COMPLETED.value},
            )
            self._finalize_run(run_id, STATUS_COMPLETED)
        except KeyboardInterrupt:
            # Injected by :meth:`cancel` to unwind a blocked worker thread.
            log_with_data(
                logger,
                logging.INFO,
                f"Hub run cancelled: run={run_id[:8]}",
                {"run_id": run_id, "status": STATUS_CANCELLED.value},
            )
            self._finalize_run(run_id, STATUS_CANCELLED)
        except Exception as exc:  # noqa: BLE001 - worker boundary records run failure
            # A pending cancel that landed while awaiting input unwinds invoke()
            # with a RuntimeError; that is expected teardown, not a failure.
            if self._cancel_requested(run_id):
                log_with_data(
                    logger,
                    logging.INFO,
                    (
                        f"Hub run cancelled during teardown: run={run_id[:8]}, "
                        f"error_type={type(exc).__name__}"
                    ),
                    {
                        "run_id": run_id,
                        "status": STATUS_CANCELLED.value,
                        "error_type": type(exc).__name__,
                    },
                )
                self._finalize_run(run_id, STATUS_CANCELLED)
            else:
                log_with_data(
                    logger,
                    logging.ERROR,
                    (
                        f"Hub run failed: run={run_id[:8]}, "
                        f"error_type={type(exc).__name__}"
                    ),
                    {
                        "run_id": run_id,
                        "status": STATUS_FAILED.value,
                        "error_type": type(exc).__name__,
                    },
                    exc_info=True,
                )
                self._finalize_run(run_id, STATUS_FAILED, error=str(exc))
        finally:
            reset_api_user_io(token)
            reset_output(output_token)

    def _cancel_requested(self, run_id: str) -> bool:
        with self._lock:
            state = self._runs.get(run_id)
            return bool(state and state["cancel_requested"])

    def _finalize_run(
        self, run_id: str, status: RunStatus, *, error: str | None = None
    ) -> None:
        """Record a run's terminal status as its worker thread unwinds.

        A pending cancel always wins: an interrupt requested mid-flight maps the
        natural completion/failure onto ``cancelled`` so the registry agrees with
        what the user asked for and what ``invoke()`` wrote to the log.
        """
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            if state["cancel_requested"]:
                status = STATUS_CANCELLED
            now = time.time()
            state["status"] = status
            state["completed_at"] = now
            state["pipe"] = None
            if error is not None:
                state["error"] = error

    def cancel(self, run_id: str) -> bool:
        """Request near-immediate cancellation of a run."""
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            status_before = state["status"]
            if status_before.is_terminal:
                logger.debug(
                    "Cancel no-op: already terminal (run_id=%s status=%s)",
                    run_id,
                    status_before.value,
                )
                return False

            state["cancel_requested"] = True
            state["status"] = STATUS_CANCELLING
            prompt_id = state["current_prompt_id"]
            thread = state["thread"]
            pipe = state["pipe"]

        return self._cancel_active_run(
            run_id=run_id,
            status_before=status_before.value,
            prompt_id=prompt_id,
            thread=thread,
            pipe=pipe,
        )

    def _cancel_active_run(
        self,
        *,
        run_id: str,
        status_before: str,
        prompt_id: str | None,
        thread: threading.Thread | None,
        pipe: EventPipe | None,
    ) -> bool:
        log_with_data(
            logger,
            logging.INFO,
            (f"Run cancellation requested: run={run_id[:8]}, status={status_before}"),
            {
                "run_id": run_id,
                "status_before": status_before,
                "prompt_id": prompt_id,
                "thread": thread.name if thread is not None else None,
                "has_pipe": pipe is not None,
            },
        )
        if thread is None:
            # Queued but never started: no thread to unwind.
            logger.debug("Cancel via queued path: no thread (run_id=%s)", run_id)
            self._finalize_run(run_id, STATUS_CANCELLED)
            return True
        if pipe is None:
            raise RuntimeError("running run has no EventPipe to cancel")
        pipe.cancel()
        if prompt_id is not None:
            logger.debug(
                "Cancel via wait-registry (run_id=%s prompt_id=%s)", run_id, prompt_id
            )
            self._wait_registry.cancel(prompt_id)
            return True
        pending_prompt_id = self._pending_prompt_id(run_id)
        if pending_prompt_id is not None:
            logger.debug(
                "Cancel via wait-registry after race (run_id=%s prompt_id=%s)",
                run_id,
                pending_prompt_id,
            )
            self._wait_registry.cancel(pending_prompt_id)
            return True
        logger.debug("Cancel via thread interrupt (run_id=%s)", run_id)
        _interrupt_thread(thread)
        return True

    def _pending_prompt_id(self, run_id: str) -> str | None:
        """Re-check prompt state to resolve RUNNING->AWAITING_INPUT race."""
        with self._lock:
            refreshed = self._runs.get(run_id)
            return refreshed["current_prompt_id"] if refreshed is not None else None

    def interrupt(self, run_id: str) -> bool:
        """Interrupt in-flight work and return control back to the agent loop."""
        with self._lock:
            state = self._runs.get(run_id)
            if state is None:
                msg = f"unknown run_id: {run_id}"
                raise KeyError(msg)
            status_before = state["status"]
            if status_before.is_terminal or status_before == STATUS_CANCELLING:
                logger.debug(
                    "Interrupt: terminal/cancelling (run_id=%s status=%s)",
                    run_id,
                    status_before.value,
                )
                return False
            if status_before == STATUS_AWAITING_USER_INPUT:
                # User already has the floor; nothing to interrupt.
                logger.debug("Interrupt: awaiting user input (run_id=%s)", run_id)
                return False
            thread = state["thread"]
            pipe = state["pipe"]

        if thread is None:
            # Queued run has no in-flight step to interrupt.
            logger.debug("Interrupt: queued, no thread (run_id=%s)", run_id)
            return False
        if pipe is None:
            raise RuntimeError("running run has no EventPipe to interrupt")
        log_with_data(
            logger,
            logging.INFO,
            (
                f"Run interrupt requested: run={run_id[:8]}, "
                f"status={status_before.value}"
            ),
            {"run_id": run_id, "status_before": status_before.value},
        )
        pipe.interrupt()
        _interrupt_thread(thread)
        return True


def _interrupt_thread(thread: threading.Thread) -> None:
    """Asynchronously raise ``KeyboardInterrupt`` inside ``thread``."""
    ident = thread.ident
    if ident is None or not thread.is_alive():
        logger.debug(
            "Skip thread interrupt: not alive (thread=%s ident=%s)", thread.name, ident
        )
        return
    logger.debug("Injecting KeyboardInterrupt (thread=%s ident=%s)", thread.name, ident)
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


__all__ = ["RunExecutor"]
