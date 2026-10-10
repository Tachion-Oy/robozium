"""Validated Hub inputs and runtime bindings for the application host."""

from __future__ import annotations

import math
import os
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from functools import cached_property, partial
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
from roboz.shed.tools.email.proton_bridge import (
    ProtonBridgeEmailService,
    ProtonBridgeSettings,
)

from robozium.api.projects import Project
from robozium.hub.deployment import robozium
from robozium.hub.logging import HubLoggingConfig
from robozium.hub.utils import slugify_project_name


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
    MODELS: Mapping[str, LLMEndpoint]
    DEFAULT_MODEL: LLMEndpoint
    MEMORY_ENDPOINT: EndpointLike
    SUBAGENTS: tuple[DeployableAgent, ...]
    TRANSCRIPTION_ENDPOINT: TranscriptionEndpointLike | None
    ADDITIONAL_DEPENDENCIES: tuple[ExternalDependency, ...] | None


@dataclass(frozen=True)
class Hub:
    """Validated deployment inputs and runtime model selection consumed by the host."""

    name: str
    sandbox: Sandbox
    logging: HubLoggingConfig
    dependency_health: DependencyHealthSettings
    models: Mapping[str, LLMEndpoint]
    default_model: LLMEndpoint
    memory_endpoint: EndpointLike
    additional_capabilities: tuple[Capability, ...]
    subagents: tuple[DeployableAgent, ...]
    transcription_endpoint: TranscriptionEndpointLike | None
    additional_dependencies: tuple[ExternalDependency, ...] | None
    deployment: Callable[..., DeployableAgent] | None = None
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
        if self.deployment is not None and not callable(self.deployment):
            raise TypeError("deployment override must be callable")
        if self.additional_dependencies is not None:
            object.__setattr__(
                self, "additional_dependencies", tuple(self.additional_dependencies)
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
        return Project(sandbox=self.sandbox.for_project(slug), slug=slug)

    def capabilities(self) -> list[ToolLabel | SkillLabel]:
        """Return declared capability labels for this Hub's orchestrator."""
        return [capability.label for capability in self.definition.capabilities]

    @cached_property
    def definition(self) -> DeployableAgent:
        """Keep one definition for dependency and capability inspection."""
        project = self.project(self.name)
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
            memory_endpoint=self.memory_endpoint,
            email_service=ProtonBridgeEmailService(
                partial(ProtonBridgeSettings.from_env, prefix="ROBOZIUM_PROTON_BRIDGE_")
            ),
            specialists=self.subagents,
            script_socket=Path(script_socket) if script_socket else None,
        )
        builtins = {capability.label.name for capability in root.capabilities}
        for capability in self.additional_capabilities:
            if capability.label.name in builtins:
                raise ValueError(
                    f"Local capability {capability.label.name!r} conflicts with a built-in; "
                    "rename its label in local/tools/ or local/skills/"
                )
        root.add_capabilities(*self.additional_capabilities)
        return root
