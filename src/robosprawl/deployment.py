"""Explicit endpoint and capability policy for RoboSprawl deployments."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from threading import Lock

from roboz import ExternalDependency, ExternalDependencyKind, LazyExternalDependency
from roboz.llm import EndpointLike, LLMEndpoint, TranscriptionEndpointLike
from roboz.runtime import EventSink
from roboz.tools.librarian import LibrarianConstructor
from roboz_shed.tools.cli_commands.run_file_command import FILE_COMMANDS_READ

from robosprawl.composition import (
    AgenticFactory,
    OrchestratorConstructor,
    RootAgentBundle,
    SubAgentSpec,
)
from robosprawl.dependency_contract import DependencyRegistration
from robosprawl.dependency_health import (
    check_executable,
    check_openai_compatible_endpoint,
)
from robosprawl.hub import HubConfig, transcription_endpoint
from robosprawl.orchestrator_factory import (
    OrchestratorEndpointGetter,
    OrchestratorFactory,
)
from robosprawl.settings import DeploymentSettings
from robosprawl.workspace import Project

_DEFAULT_SETTINGS = DeploymentSettings()
ORCHESTRATOR_MODELS = {
    _DEFAULT_SETTINGS.endpoints[key].label: _DEFAULT_SETTINGS.endpoints[key].endpoint()
    for key in _DEFAULT_SETTINGS.selectable_models
}
DEFAULT_ORCHESTRATOR_MODEL = ORCHESTRATOR_MODELS[
    _DEFAULT_SETTINGS.endpoints[_DEFAULT_SETTINGS.default_model].label
]
DEFAULT_MEMORY_MODEL = _DEFAULT_SETTINGS.endpoints[
    _DEFAULT_SETTINGS.memory_model
].endpoint()


class OrchestratorModelSelector:
    def __init__(
        self,
        models: Mapping[str, LazyExternalDependency[LLMEndpoint]],
        *,
        default: LazyExternalDependency[LLMEndpoint],
    ) -> None:
        self.models = dict(models)
        self._models_by_id = {
            endpoint.dependency_id: endpoint for endpoint in self.models.values()
        }
        if len(self._models_by_id) != len(models):
            raise ValueError("selectable model ids must be unique")
        if default.dependency_id not in self._models_by_id:
            raise ValueError("default model must be selectable")
        self._selected_model_id = default.dependency_id
        self._lock = Lock()

    @property
    def selected_model_id(self) -> str:
        with self._lock:
            return self._selected_model_id

    @property
    def selected_endpoint(self) -> LazyExternalDependency[LLMEndpoint]:
        with self._lock:
            return self._models_by_id[self._selected_model_id]

    def endpoint(self, model_id: str) -> LazyExternalDependency[LLMEndpoint]:
        try:
            return self._models_by_id[model_id]
        except KeyError:
            raise KeyError(model_id) from None

    def select(self, model_id: str) -> None:
        with self._lock:
            if model_id not in self._models_by_id:
                raise KeyError(model_id)
            self._selected_model_id = model_id

    @staticmethod
    def standard_model_selector() -> "OrchestratorModelSelector":
        return OrchestratorModelSelector(
            ORCHESTRATOR_MODELS,
            default=DEFAULT_ORCHESTRATOR_MODEL,
        )


class OrchestratorEndpointRoute(LazyExternalDependency[LLMEndpoint]):
    """Stable dependency identity that routes calls to the bound run endpoint."""

    def __init__(self, endpoint_getter: OrchestratorEndpointGetter) -> None:
        initial_endpoint = endpoint_getter()
        super().__init__(
            dependency_id_value=initial_endpoint.dependency_id,
            dependency_kind=initial_endpoint.kind,
            metadata=initial_endpoint.redacted_metadata(),
            resolver=lambda: endpoint_getter().materialize(),
        )

    def materialize(self) -> LLMEndpoint:
        # The selected dependency validates its own concrete endpoint.
        # This route is an alias, so its stable inspection id intentionally does
        # not have to match the selected endpoint's id.
        return self.resolver()


def standard_factory(
    *,
    subagents: Sequence[SubAgentSpec] = (),
    orchestrator_endpoint: EndpointLike = DEFAULT_ORCHESTRATOR_MODEL,
    memory_endpoint: EndpointLike = DEFAULT_MEMORY_MODEL,
) -> AgenticFactory:
    return AgenticFactory(
        orchestrator=OrchestratorConstructor(
            agent_endpoint=orchestrator_endpoint, subagents=tuple(subagents)
        ),
        librarian=LibrarianConstructor(snapshot_endpoint=memory_endpoint),
    )


def standard_orchestrator_factory(
    project: Project,
    /,
    *,
    endpoint_getter: OrchestratorEndpointGetter,
    event_sinks: Sequence[EventSink],
) -> RootAgentBundle:
    return standard_factory(
        orchestrator_endpoint=OrchestratorEndpointRoute(endpoint_getter)
    )(project, event_sinks=event_sinks)


@dataclass(frozen=True)
class HubDeployment:
    """A complete, internally consistent dependency set for one Hub app."""

    config: HubConfig
    orchestrator_factory: OrchestratorFactory
    model_selector: OrchestratorModelSelector
    transcription_endpoint: TranscriptionEndpointLike | None
    inspectable_endpoints: tuple[ExternalDependency, ...]
    dependency_registry: tuple[DependencyRegistration, ...] | None = None

    @classmethod
    def standard(cls, config: HubConfig) -> "HubDeployment":
        settings = config.deployment
        endpoints = {key: value.endpoint() for key, value in settings.endpoints.items()}
        selector = OrchestratorModelSelector(
            {
                settings.endpoints[key].label: endpoints[key]
                for key in settings.selectable_models
            },
            default=endpoints[settings.default_model],
        )
        memory = endpoints[settings.memory_model]

        def factory(
            project: Project,
            /,
            *,
            endpoint_getter: OrchestratorEndpointGetter,
            event_sinks: Sequence[EventSink],
        ) -> RootAgentBundle:
            return standard_factory(
                orchestrator_endpoint=OrchestratorEndpointRoute(endpoint_getter),
                memory_endpoint=memory,
            )(project, event_sinks=event_sinks)

        used = {
            endpoint.dependency_id: endpoint
            for endpoint in (*selector.models.values(), memory)
        }
        return cls(
            config=config,
            orchestrator_factory=factory,
            model_selector=selector,
            transcription_endpoint=transcription_endpoint(),
            inspectable_endpoints=tuple(selector.models.values()),
            dependency_registry=(
                *EXECUTABLE_DEPENDENCY_REGISTRATIONS,
                *(
                    DependencyRegistration(
                        endpoint.dependency_id,
                        endpoint.kind,
                        check_openai_compatible_endpoint,
                    )
                    for endpoint in used.values()
                ),
            ),
        )

    @classmethod
    def custom(
        cls,
        config: HubConfig,
        orchestrator_factory: OrchestratorFactory,
        transcription_endpoint: TranscriptionEndpointLike | None,
        *,
        model_selector: OrchestratorModelSelector | None = None,
        dependency_registry: Sequence[DependencyRegistration] | None = None,
    ) -> "HubDeployment":
        return cls(
            config=config,
            orchestrator_factory=orchestrator_factory,
            model_selector=model_selector
            or OrchestratorModelSelector(
                {
                    config.deployment.endpoints[key].label: config.deployment.endpoints[
                        key
                    ].endpoint()
                    for key in config.deployment.selectable_models
                },
                default=config.deployment.endpoints[
                    config.deployment.default_model
                ].endpoint(),
            ),
            transcription_endpoint=transcription_endpoint,
            inspectable_endpoints=tuple(model_selector.models.values())
            if model_selector is not None
            else (),
            dependency_registry=tuple(dependency_registry)
            if dependency_registry is not None
            else None,
        )


EXECUTABLE_DEPENDENCY_REGISTRATIONS = tuple(
    DependencyRegistration(
        dependency_id=f"executable:{spec.name}",
        kind=ExternalDependencyKind.EXECUTABLE,
        check=check_executable,
    )
    for spec in FILE_COMMANDS_READ
)
MODEL_ENDPOINT_DEPENDENCY_REGISTRATIONS = tuple(
    DependencyRegistration(
        dependency_id=endpoint.dependency_id,
        kind=endpoint.kind,
        check=check_openai_compatible_endpoint,
    )
    for endpoint in ORCHESTRATOR_MODELS.values()
)
STANDARD_DEPENDENCY_REGISTRY = (
    *EXECUTABLE_DEPENDENCY_REGISTRATIONS,
    *MODEL_ENDPOINT_DEPENDENCY_REGISTRATIONS,
)
