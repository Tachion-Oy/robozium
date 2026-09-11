"""Application composition using shared agents and deployment assembly."""

from collections.abc import Callable, Sequence
from dataclasses import replace
from typing import Protocol

from roboshed.agents import librarian, orchestrator
from roboshed.deployments import Deployment
from roboshed.sandbox import Sandbox
from roboz.dependencies import DependencyRoute, LazyExternalDependency
from roboz.deployment import AgentCapability, DeployableAgent
from roboz.llm import EndpointLike, LLMEndpoint
from roboz.runtime import EventSink, Output


class ConfigureDeployment(Protocol):
    """Configure a fresh graph using the run's sandbox, model route, and sinks."""

    def __call__(
        self,
        sandbox: Sandbox,
        project_slug: str,
        /,
        *,
        endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
        event_sinks: Sequence[EventSink] = (),
    ) -> Deployment:
        """Return an unbuilt deployment; the host owns runtime lifecycle."""
        ...


def compose_deployment(
    sandbox: Sandbox,
    project_slug: str,
    /,
    *,
    endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
    event_sinks: Sequence[EventSink] = (),
    memory_endpoint: EndpointLike,
    additional_capabilities: Sequence[AgentCapability],
    subagents: Sequence[DeployableAgent],
    interaction_mode: Output | None,
    project_context: str,
) -> Deployment:
    """Bind the configured persistent graph to one already-scoped sandbox."""
    if sandbox.scope != project_slug:
        raise ValueError("deployment project must match the sandbox scope")
    foreground = orchestrator(
        sandbox,
        agent_endpoint=DependencyRoute(endpoint_getter),
        subagents=subagents,
        interaction_mode=interaction_mode,
        initial_messages=(sandbox.project_memory_dir(),),
    )
    context = project_context.format(
        sandbox=sandbox,
        project_slug=project_slug,
        project_root=sandbox.project_dir(),
        project_logs=sandbox.project_logs_dir(),
        project_snapshots=sandbox.project_snapshots_dir(),
        project_memory=sandbox.project_memory_dir(),
    )
    root = replace(
        foreground,
        system_prompt=f"{foreground.system_prompt}\n\n{context}",
        background_agents=(
            librarian(
                sandbox,
                foreground.agent_names(include_background=False),
                agent_endpoint=memory_endpoint,
            ),
        ),
    )
    return Deployment(
        agent=root,
        sandbox=sandbox,
        additional_capabilities=tuple(additional_capabilities),
        event_sinks=list(event_sinks),
    )
