"""Explicit endpoint and capability policy for RoboSprawl deployments."""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from threading import Lock

from roboz import ExternalDependency, ExternalDependencyKind, LazyExternalDependency
from roboz.llm import EndpointLike, LLMEndpoint, TranscriptionEndpointLike
from roboz.runtime import EventSink
from roboz.tools.librarian import LibrarianConstructor
from roboz_openai import openai_endpoint
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
from robosprawl.workspace import Project


def _router(model: str, effort: str):
    return openai_endpoint(
        model=model,
        max_context_tokens=1_310_720,
        api_name="openrouter",
        base_url="https://openrouter.ai/api/v1",
        api_key_env="OPENROUTER_API_KEY",
        extra_body={
            "provider": {"sort": "throughput", "require_parameters": True},
            "reasoning": {"effort": effort},
        },
    )


ORCHESTRATOR_MODELS = {
    "GLM-5.3 · OpenRouter": _router("z-ai/glm-5.3", "low"),
    "GLM-5.3 Flash · OpenRouter": _router("z-ai/glm-5.3-flash", "low"),
    "GPT-OSS-120B · Cerebras": openai_endpoint(
        model="gpt-oss-120b",
        max_context_tokens=131072,
        api_name="cerebras",
        base_url="https://api.cerebras.ai/v1",
        api_key_env="CEREBRAS_API_KEY",
    ),
}
DEFAULT_ORCHESTRATOR_MODEL = next(iter(ORCHESTRATOR_MODELS.values()))
DEFAULT_MEMORY_MODEL = _router("z-ai/glm-5.3", "high")


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
) -> AgenticFactory:
    return AgenticFactory(
        orchestrator=OrchestratorConstructor(
            agent_endpoint=orchestrator_endpoint, subagents=tuple(subagents)
        ),
        librarian=LibrarianConstructor(snapshot_endpoint=DEFAULT_MEMORY_MODEL),
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

    @classmethod
    def standard(cls, config: HubConfig) -> "HubDeployment":
        selector = OrchestratorModelSelector.standard_model_selector()
        return cls(
            config=config,
            orchestrator_factory=standard_orchestrator_factory,
            model_selector=selector,
            transcription_endpoint=transcription_endpoint(),
            inspectable_endpoints=tuple(selector.models.values()),
        )

    @classmethod
    def custom(
        cls,
        config: HubConfig,
        orchestrator_factory: OrchestratorFactory,
        transcription_endpoint: TranscriptionEndpointLike | None,
    ) -> "HubDeployment":
        return cls(
            config=config,
            orchestrator_factory=orchestrator_factory,
            model_selector=OrchestratorModelSelector.standard_model_selector(),
            transcription_endpoint=transcription_endpoint,
            inspectable_endpoints=(),
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
