"""Validated Hub inputs and runtime bindings for the application host."""

from __future__ import annotations

import math
import os
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, replace
from functools import cached_property
from pathlib import Path
from types import MappingProxyType
from typing import TypedDict

from roboz.dependencies import ExternalDependency
from roboz.deployment import Capability, DeployableAgent, SkillLabel, ToolLabel
from roboz.llm import (
    EndpointLike,
    LLMEndpoint,
    ModelSelector,
    TranscriptionEndpointLike,
)
from roboz.shed.sandbox import Sandbox

from robozium.api.projects import Project
from robozium.hub.deployment import robozium
from robozium.hub.local import load_local_capabilities
from robozium.hub.logging import HubLoggingConfig
from robozium.hub.utils import slugify_project_name


@dataclass(frozen=True)
class DependencyHealthSettings:
    """Explicit timing policy for dependency polling and bounded checks."""

    interval_s: float
    timeout_s: float

    def __post_init__(self) -> None:
        self._validate_timings(self.interval_s, self.timeout_s)

    @staticmethod
    def _validate_timings(interval_s: float, timeout_s: float) -> None:
        for value in (interval_s, timeout_s):
            if isinstance(value, bool) or not math.isfinite(value) or value <= 0:
                raise ValueError("dependency health timings must be finite and positive")


class HubValues(TypedDict):
    """Required configuration exports; helper constants may coexist in the module."""

    NAME: str
    SANDBOX: Sandbox
    LOGGING: HubLoggingConfig
    DEPENDENCY_HEALTH: DependencyHealthSettings
    MODELS: Mapping[str, LLMEndpoint]
    DEFAULT_MODEL: LLMEndpoint
    MEMORY_ENDPOINT: EndpointLike
    SUBAGENTS: tuple[DeployableAgent, ...]
    TRANSCRIPTION_ENDPOINT: TranscriptionEndpointLike | None
    ADDITIONAL_DEPENDENCIES: tuple[ExternalDependency, ...] | None


@dataclass(frozen=True)
class HubSettings:
    """Configuration inputs, separate from mutable application runtime state."""

    config_file: Path
    name: str
    sandbox: Sandbox
    logging: HubLoggingConfig
    dependency_health: DependencyHealthSettings
    models: Mapping[str, LLMEndpoint]
    default_model: LLMEndpoint
    memory_endpoint: EndpointLike
    subagents: tuple[DeployableAgent, ...]
    transcription_endpoint: TranscriptionEndpointLike | None
    additional_dependencies: tuple[ExternalDependency, ...] | None


class Hub:
    """Own model selection and deployment definitions for one application."""

    def __init__(
        self,
        settings: HubSettings,
        *,
        additional_capabilities: tuple[Capability, ...] | None = None,
        deployment: Callable[..., DeployableAgent] | None = None,
    ) -> None:
        self.settings = replace(
            settings,
            models=MappingProxyType(dict(settings.models)),
            additional_dependencies=(
                tuple(settings.additional_dependencies)
                if settings.additional_dependencies is not None else None
            ),
        )
        self._validate_labels(settings)
        self.model_selector = ModelSelector(
            self.settings.models, default=settings.default_model
        )
        if deployment is not None and not callable(deployment):
            raise TypeError("deployment override must be callable")
        self.deployment = deployment
        self._validate_storage_paths(self.settings.sandbox, self.settings.logging)
        self.additional_capabilities = (
            load_local_capabilities(settings.config_file.parent)
            if additional_capabilities is None else tuple(additional_capabilities)
        )

    def project(self, name: str) -> Project:
        """Derive a shared project without creating directories."""
        slug = slugify_project_name(name)
        return Project(sandbox=self.settings.sandbox.for_project(slug), slug=slug)

    def capabilities(self) -> list[ToolLabel | SkillLabel]:
        """Return declared capability labels for this Hub's orchestrator."""
        return [capability.label for capability in self.definition.capabilities]

    @cached_property
    def definition(self) -> DeployableAgent:
        """Keep one definition for dependency and capability inspection."""
        project = self.project(self.settings.name)
        return self.configure_deployment(
            project.sandbox,
            project.slug,
            endpoint_getter=lambda: self.model_selector.selected_endpoint,
        )

    def configure_deployment(
        self,
        sandbox: Sandbox,
        project_slug: str,
        /,
        *,
        endpoint_getter: Callable[[], LLMEndpoint],
    ) -> DeployableAgent:
        """Describe fresh agents with this Hub's choices and run inputs."""
        if sandbox.scope is not None and sandbox.scope != project_slug:
            raise ValueError("deployment project must match the sandbox scope")
        sandbox = sandbox.for_project(project_slug)
        if self.deployment is not None:
            return self.deployment(
                sandbox,
                project_slug,
                endpoint_getter=endpoint_getter,
            )
        script_socket = os.environ.get("ROBOZIUM_HOST_SCRIPT_SOCKET")
        root = robozium(
            sandbox,
            endpoint_getter=endpoint_getter,
            memory_endpoint=self.settings.memory_endpoint,
            specialists=self.settings.subagents,
            script_socket=Path(script_socket) if script_socket else None,
        )
        self._validate_local_capability_names(
            root.capabilities, self.additional_capabilities
        )
        root.add_capabilities(*self.additional_capabilities)
        return root

    @staticmethod
    def _validate_labels(settings: HubSettings) -> None:
        if not isinstance(settings.name, str) or not settings.name.strip():
            raise ValueError("hub name must be nonempty")
        if not settings.models or any(not name.strip() for name in settings.models):
            raise ValueError("model labels must be nonempty")

    @staticmethod
    def _validate_storage_paths(sandbox: Sandbox, logging: HubLoggingConfig) -> None:
        for folder in (sandbox.readonly, sandbox.shared, sandbox.projects):
            if len(Path(folder).parts) != 1 or folder in {".", ".."}:
                raise ValueError("sandbox area names must be single folder names")
        for folder in (sandbox.logs, sandbox.snapshots, sandbox.memory):
            if folder.is_absolute() or ".." in folder.parts:
                raise ValueError("persistence folders must stay within their project")
        Project(
            sandbox=sandbox.for_project("configuration-check"),
            slug="configuration-check",
        )
        if logging.path.resolve().is_relative_to(sandbox.projects_dir):
            raise ValueError("logging path must be outside projects")

    @staticmethod
    def _validate_local_capability_names(
        builtins: Iterable[Capability], additional: Iterable[Capability]
    ) -> None:
        builtin_names = {capability.label.name for capability in builtins}
        for capability in additional:
            if capability.label.name in builtin_names:
                raise ValueError(
                    f"Local capability {capability.label.name!r} conflicts with a built-in; "
                    "rename its label in the capability package"
                )
