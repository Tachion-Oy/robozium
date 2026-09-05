"""Host user I/O for :class:`~roboz.models.Output.API` runs."""

from __future__ import annotations

import logging
from threading import Lock
from uuid import uuid4

from roboz.models import Message, MessageKind, Role
from roboz.runtime import log_with_data
from roboz.runtime.events import EventSink, MessageEvent

from robosprawl.api.state import STATUS_AWAITING_USER_INPUT, STATUS_RUNNING, RunState
from robosprawl.api.wait_registry import RunCancelled, WaitRegistry

logger = logging.getLogger(__name__)


class ApiUserIO:
    """Blocks on :class:`WaitRegistry` until HTTP posts a reply for ``prompt_id``.

    Returns None if the per-prompt ``timeout`` elapses before a reply arrives.

    One-way :meth:`notify` output is emitted as a tagged assistant
    :class:`MessageEvent`. Runtime telemetry, such as shell-script output, is
    emitted through the agent's :class:`~roboz.runtime.pipe.EventPipe`.
    """

    def __init__(
        self,
        registry: WaitRegistry,
        run_state: RunState,
        state_lock: Lock,
        event_sink: EventSink,
    ) -> None:
        self._registry = registry
        self._state = run_state
        self._state_lock = state_lock
        self._event_sink = event_sink

    def request_input(self, message: str, timeout: float | None = None) -> str | None:
        prompt_id = str(uuid4())
        project = self._state.get("project")
        slug = project.slug if project is not None else "?"
        with self._state_lock:
            self._state["current_prompt_id"] = prompt_id
            self._state["current_prompt"] = message
            self._state["status"] = STATUS_AWAITING_USER_INPUT
        self._registry.register(prompt_id)
        log_with_data(
            logger,
            logging.INFO,
            f"Run awaiting user input: project={slug}, timeout={timeout}",
            {"project": slug, "prompt_id": prompt_id, "timeout_s": timeout},
        )
        logger.debug("User-input wait registered prompt_id=%s", prompt_id)
        try:
            reply = self._registry.wait(prompt_id, timeout_s=timeout)
            log_with_data(
                logger,
                logging.INFO,
                f"User input received: project={slug}",
                {"project": slug, "prompt_id": prompt_id},
            )
            return reply
        except TimeoutError:
            log_with_data(
                logger,
                logging.INFO,
                f"User input timed out: project={slug}",
                {"project": slug, "prompt_id": prompt_id},
            )
            return None
        except RunCancelled:
            # A cancel releases the wait by raising; this is the happy path, so
            # log it plainly and let it unwind invoke().
            log_with_data(
                logger,
                logging.INFO,
                f"User input wait cancelled: project={slug}",
                {"project": slug, "prompt_id": prompt_id},
            )
            raise
        except Exception as exc:
            log_with_data(
                logger,
                logging.ERROR,
                (
                    f"User input wait failed: project={slug}, "
                    f"error_type={type(exc).__name__}"
                ),
                {
                    "project": slug,
                    "prompt_id": prompt_id,
                    "error_type": type(exc).__name__,
                },
                exc_info=True,
            )
            raise
        finally:
            with self._state_lock:
                self._state["current_prompt_id"] = None
                self._state["current_prompt"] = None
                if self._state["status"] == STATUS_AWAITING_USER_INPUT:
                    logger.debug(
                        "Status transition awaiting_user_input -> running "
                        "(project=%s prompt_id=%s)",
                        slug,
                        prompt_id,
                    )
                    self._state["status"] = STATUS_RUNNING

    def notify(self, message: str) -> None:
        """Stream a tagged, one-way assistant notification to the HUD.

        Generic host notifications use the message trace. Tool/runtime telemetry
        should use the agent event pipe instead, so it shares the runtime event
        stream with messages and lifecycle events.
        """
        self._event_sink(
            MessageEvent(
                message=Message(
                    role=Role.ASSISTANT,
                    content=message,
                    message_kind=MessageKind.USER_NOTIFICATION,
                ),
                sequence=0,
            )
        )


__all__ = ["ApiUserIO"]
