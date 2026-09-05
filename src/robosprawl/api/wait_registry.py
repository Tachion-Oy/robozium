"""In-process wait slots for API-driven user replies (no polling in the agent thread)."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from threading import Event, Lock

from roboz.exceptions import ExternalCallCancelledError
from roboz.runtime import log_with_data

logger = logging.getLogger(__name__)


class RunCancelled(ExternalCallCancelledError):
    """Raised by :meth:`WaitRegistry.wait` when a cancel releases the wait.

    This maps API prompt cancellation onto the same cancellation boundary that
    :meth:`roboz.agent.core.Agent.invoke` already treats as ``cancelled``.
    """


@dataclass
class _WaitSlot:
    event: Event = field(default_factory=Event)
    reply: str | None = None
    cancelled: bool = False


class WaitRegistry:
    """Register a prompt id, block until :meth:`resolve` or :meth:`cancel`."""

    def __init__(self) -> None:
        self._lock = Lock()
        self._slots: dict[str, _WaitSlot] = {}

    def register(self, prompt_id: str) -> None:
        with self._lock:
            if prompt_id in self._slots:
                msg = f"prompt_id already registered: {prompt_id}"
                raise RuntimeError(msg)
            self._slots[prompt_id] = _WaitSlot()
        logger.debug("Wait slot registered (prompt_id=%s)", prompt_id)

    def wait(self, prompt_id: str, *, timeout_s: float | None = None) -> str:
        with self._lock:
            slot = self._slots.get(prompt_id)
        if slot is None:
            msg = f"unknown prompt_id: {prompt_id}"
            raise RuntimeError(msg)

        if not slot.event.wait(timeout_s):
            with self._lock:
                self._slots.pop(prompt_id, None)
            msg = f"timed out waiting for prompt_id={prompt_id}"
            raise TimeoutError(msg)

        with self._lock:
            popped = self._slots.pop(prompt_id, None)
        if popped is None:
            msg = f"wait slot missing after signal: {prompt_id}"
            raise RuntimeError(msg)
        if popped.cancelled:
            msg = "run cancelled while awaiting user input"
            raise RunCancelled(msg)
        if popped.reply is None:
            msg = f"prompt {prompt_id} signaled without reply"
            raise RuntimeError(msg)
        return popped.reply

    def discard(self, prompt_id: str) -> None:
        """Release a wait interrupted before its normal result/timeout cleanup."""
        with self._lock:
            self._slots.pop(prompt_id, None)

    def resolve(self, prompt_id: str, content: str) -> bool:
        with self._lock:
            slot = self._slots.get(prompt_id)
            if slot is None:
                logger.warning(
                    "Resolve for unknown/inactive prompt (prompt_id=%s)", prompt_id
                )
                return False
            if slot.event.is_set():
                return False
            slot.reply = content
            slot.event.set()
        log_with_data(
            logger,
            logging.DEBUG,
            f"Wait slot resolved: prompt={prompt_id[:8]}",
            {"prompt_id": prompt_id},
        )
        return True

    def cancel(self, prompt_id: str) -> bool:
        with self._lock:
            slot = self._slots.get(prompt_id)
            if slot is None:
                logger.warning(
                    "Cancel for unknown/inactive prompt (prompt_id=%s)", prompt_id
                )
                return False
            slot.cancelled = True
            slot.event.set()
        log_with_data(
            logger,
            logging.DEBUG,
            f"Wait slot cancelled: prompt={prompt_id[:8]}",
            {"prompt_id": prompt_id},
        )
        return True


__all__ = ["RunCancelled", "WaitRegistry"]
