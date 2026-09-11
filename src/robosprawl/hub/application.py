"""Validated Hub inputs and runtime bindings for the application host."""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import TypedDict

from roboshed.agents import librarian, orchestrator
from roboshed.deployments import Deployment
from roboshed.sandbox import Sandbox
from roboz.dependencies import (
    DependencyRegistration,
    DependencyRoute,
    LazyExternalDependency,
)
from roboz.deployment import AgentCapability, DeployableAgent
from roboz.llm import (
    EndpointLike,
    LLMEndpoint,
    ModelSelector,
    TranscriptionEndpointLike,
)
from roboz.runtime import EventSink, Output

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
    CAPABILITIES: Sequence[AgentCapability]
    MEMORY_ENDPOINT: EndpointLike
    SUBAGENTS: Sequence[DeployableAgent]
    INTERACTION_MODE: Output | None
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
    capabilities: Sequence[AgentCapability]
    memory_endpoint: EndpointLike
    subagents: Sequence[DeployableAgent]
    interaction_mode: Output | None
    transcription_endpoint: TranscriptionEndpointLike | None
    dependency_registry: tuple[DependencyRegistration, ...] | None
    deployment: Callable[..., Deployment] | None = None
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
        object.__setattr__(self, "capabilities", tuple(self.capabilities))
        object.__setattr__(self, "subagents", tuple(self.subagents))
        if self.deployment is not None and not callable(self.deployment):
            raise TypeError("deployment override must be callable")
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
        return Project(sandbox=self.sandbox.for_project(slug), slug=slug)

    def configure_deployment(
        self,
        sandbox: Sandbox,
        project_slug: str,
        /,
        *,
        endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
        event_sinks: Sequence[EventSink] = (),
    ) -> Deployment:
        """Construct a fresh scoped graph; the host owns build and execution."""
        if sandbox.scope is not None and sandbox.scope != project_slug:
            raise ValueError("deployment project must match the sandbox scope")
        sandbox = sandbox.for_project(project_slug)
        if self.deployment is not None:
            return self.deployment(
                sandbox,
                project_slug,
                endpoint_getter=endpoint_getter,
                event_sinks=event_sinks,
            )
        names = {"orchestrator"}
        for specialist in self.subagents:
            names.update(specialist.agent_names(include_background=False))
        memory = librarian(sandbox, names, agent_endpoint=self.memory_endpoint)
        context = (
            "## Project context\n"
            f"File tool base: {sandbox.resolved_root}\n"
            f"Project: {project_slug}\n"
            f"Writable project directory: {sandbox.project_dir()}\n"
            f"Read-only directory: {sandbox.readonly_dir}\n"
            f"Shared directory: {sandbox.shared_dir}\n"
            f"Conversation logs: {sandbox.project_logs_dir()}\n"
            f"Snapshots: {sandbox.project_snapshots_dir()}\n"
            f"Memory: {sandbox.project_memory_dir()}"
        )
        return Deployment(
            agent=orchestrator(
                sandbox,
                agent_endpoint=DependencyRoute(endpoint_getter),
                subagents=self.subagents,
                background_agents=(memory,),
                interaction_mode=self.interaction_mode,
                initial_messages=(sandbox.project_memory_dir(), context),
            ),
            sandbox=sandbox,
            additional_capabilities=tuple(self.capabilities),
            event_sinks=list(event_sinks),
        )
