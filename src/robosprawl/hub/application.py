"""Validated Hub inputs and runtime bindings for the application host."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import TypedDict

from roboshed.deployments.robosprawl import RunFactory
from roboshed.sandbox import Sandbox
from roboz.dependencies import DependencyRegistration, LazyExternalDependency
from roboz.llm import LLMEndpoint, ModelSelector, TranscriptionEndpointLike

from robosprawl.api.projects import Project
from robosprawl.hub.logging import HubLoggingConfig
from robosprawl.hub.utils import slugify_project_name


@dataclass(frozen=True)
class DependencyHealthSettings:
    """Explicit timing policy for dependency polling and bounded checks."""

    interval_s: float
    timeout_s: float

    def __post_init__(self) -> None:
        for value in (self.interval_s, self.timeout_s):
            if isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                raise ValueError(
                    "dependency health timings must be finite and positive"
                )


class HubValues(TypedDict):
    """Required configuration exports; helper constants may coexist in the module."""

    NAME: str
    SANDBOX: Sandbox
    LOGGING: HubLoggingConfig
    DEPENDENCY_HEALTH: DependencyHealthSettings
    MODELS: Mapping[str, LazyExternalDependency[LLMEndpoint]]
    DEFAULT_MODEL: LazyExternalDependency[LLMEndpoint]
    DEPLOYMENT: RunFactory
    TRANSCRIPTION_ENDPOINT: TranscriptionEndpointLike | None
    DEPENDENCY_REGISTRY: tuple[DependencyRegistration, ...] | None


@dataclass(frozen=True)
class Hub:
    """Validated deployment inputs and runtime model selection consumed by the host."""

    name: str
    sandbox: Sandbox
    logging: HubLoggingConfig
    dependency_health: DependencyHealthSettings
    models: Mapping[str, LazyExternalDependency[LLMEndpoint]]
    default_model: LazyExternalDependency[LLMEndpoint]
    deployment: RunFactory
    transcription_endpoint: TranscriptionEndpointLike | None
    dependency_registry: tuple[DependencyRegistration, ...] | None
    model_selector: ModelSelector = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        if not isinstance(self.name, str) or not self.name.strip():
            raise ValueError("hub name must be nonempty")
        object.__setattr__(self, "models", MappingProxyType(dict(self.models)))
        if not self.models or any(not name.strip() for name in self.models):
            raise ValueError("model labels must be nonempty")
        object.__setattr__(
            self,
            "model_selector",
            ModelSelector(self.models, default=self.default_model),
        )
        if not callable(self.deployment):
            raise TypeError("deployment must implement RunFactory")
        if self.dependency_registry is not None:
            object.__setattr__(
                self, "dependency_registry", tuple(self.dependency_registry)
            )
        for folder in (
            self.sandbox.readonly,
            self.sandbox.shared,
            self.sandbox.projects,
        ):
            if len(Path(folder).parts) != 1 or folder in {".", ".."}:
                raise ValueError("sandbox area names must be single folder names")
        for folder in (
            self.sandbox.logs,
            self.sandbox.snapshots,
            self.sandbox.memory,
        ):
            if folder.is_absolute() or ".." in folder.parts:
                raise ValueError("persistence folders must stay within their project")
        self.project("configuration-check")
        if self.logging.path.resolve().is_relative_to(self.sandbox.projects_dir):
            raise ValueError("logging path must be outside projects")

    def project(self, name: str) -> Project:
        """Derive a shared project without creating directories."""
        slug = slugify_project_name(name)
        self.sandbox.project_memory_dir(slug)
        return Project(sandbox=self.sandbox, slug=slug)
