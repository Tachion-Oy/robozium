"""Typed exceptions raised by the robozium API layer."""

from __future__ import annotations


class ProjectCancellationInProgressError(RuntimeError):
    """Raised when a new run is requested before cancellation has settled."""


class ProjectBusyError(RuntimeError):
    """Raised when active project work prevents the requested run creation."""


class InvalidCapabilitySelection(ValueError):
    """The requested capability selection cannot be applied."""


__all__ = [
    "ProjectBusyError",
    "ProjectCancellationInProgressError",
    "InvalidCapabilitySelection",
]
