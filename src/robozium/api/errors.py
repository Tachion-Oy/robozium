"""Typed exceptions raised by the robozium API layer."""

from __future__ import annotations


class ProjectCancellationInProgressError(RuntimeError):
    """Raised when a new run is requested before cancellation has settled."""


class ProjectBusyError(RuntimeError):
    """Raised when active project work prevents the requested run creation."""


class InvalidCapabilitySelection(ValueError):
    """The requested capability selection cannot be applied."""


class EnvironmentConflictError(RuntimeError):
    """Saved settings changed or an imported package already occupies its destination."""


class EnvironmentImportNotFoundError(LookupError):
    """No imported package with the requested name exists."""


class RepositoryUnavailableError(RuntimeError):
    """GitHub could not be reached or answered unexpectedly; retrying may help."""


__all__ = [
    "EnvironmentConflictError",
    "EnvironmentImportNotFoundError",
    "ProjectBusyError",
    "ProjectCancellationInProgressError",
    "InvalidCapabilitySelection",
    "RepositoryUnavailableError",
]
