"""Typed exceptions raised by the robosprawl API layer."""

from __future__ import annotations


class ProjectCancellationInProgressError(RuntimeError):
    """Raised when a new run is requested before cancellation has settled."""


class ProjectBusyError(RuntimeError):
    """Raised when durable background work prevents a new project run."""


__all__ = ["ProjectBusyError", "ProjectCancellationInProgressError"]
