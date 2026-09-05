"""The single construction contract for Hub orchestrator runs."""

from collections.abc import Callable, Sequence
from typing import Protocol

from roboz.llm import LLMEndpoint
from roboz.runtime.events import EventSink
from roboz.tooling import LazyExternalDependency

from robosprawl.composition import RootAgentBundle
from robosprawl.workspace import Project

type OrchestratorEndpointGetter = Callable[[], LazyExternalDependency[LLMEndpoint]]


class OrchestratorFactory(Protocol):
    def __call__(
        self,
        project: Project,
        /,
        *,
        endpoint_getter: OrchestratorEndpointGetter,
        event_sinks: Sequence[EventSink],
    ) -> RootAgentBundle: ...


__all__ = ["OrchestratorEndpointGetter", "OrchestratorFactory"]
