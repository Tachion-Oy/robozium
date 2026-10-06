"""Minimal deployment double for tests that supply controlled runtime agents."""

from dataclasses import replace
from types import SimpleNamespace
from typing import NamedTuple

from roboz.agent import Agent
from roboz.deployment import DeployableAgent
from roboz.llm import LLMEndpoint, MockLLMEndpoint
from roboz.runtime import default_event_sinks

from robozium.hub.utils import load_hub


class BuiltAgents(NamedTuple):
    """Name the two elements of a controlled test factory's result."""

    agent: Agent
    background_agents: tuple[Agent, ...] = ()


def deferred_deployment(factory):
    """Keep controlled runtime construction in build(), as real definitions do."""
    def configure(sandbox, project_slug, *, endpoint_getter):
        class Definition(DeployableAgent):
            def build(self, **kwargs):
                return factory(
                    sandbox,
                    project_slug,
                    endpoint_getter=endpoint_getter,
                    event_sinks=kwargs.get("event_sinks", ()),
                )

        return Definition(name="test")

    return configure


def configured_deployment(project, endpoint, **choices):
    """Use the real application composition with an explicit test endpoint."""
    if isinstance(endpoint, MockLLMEndpoint):
        scripted = endpoint

        def create(**request):
            del request
            response = scripted.mock_responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return SimpleNamespace(
                usage=None,
                choices=[SimpleNamespace(message=SimpleNamespace(content=response))],
            )

        endpoint = LLMEndpoint(
            client=SimpleNamespace(
                models=object(),
                close=lambda: None,
                chat=SimpleNamespace(completions=SimpleNamespace(create=create)),
            ),
            api_name=scripted.api_name,
            model_name=scripted.model_name,
            max_context_tokens=scripted.max_context_tokens,
            stream=False,
        )
    event_sinks = choices.pop("event_sinks", ())
    choices.setdefault("memory_endpoint", MockLLMEndpoint([]))
    hub = load_hub()
    hub = replace(hub, **choices)
    definition = hub.configure_deployment(
        project.sandbox,
        project.slug,
        endpoint_getter=lambda: endpoint,
    )
    return definition.build(
        event_sinks=event_sinks,
        event_sink_factory=lambda name: default_event_sinks(
            data_path=project.logs / name,
            include_cli=False,
        ),
    )


def foreground_agent(agents, *, omit_skills=False):
    """Isolate foreground behavior after building the unchanged production recipe."""
    agent, _ = agents
    return agent.copy(
        default_tools=tuple(
            tool
            for tool in agent.default_tools
            if not tool.name.startswith("start_background_agent_")
        ),
        auto_loaded_skills=() if omit_skills else agent.auto_loaded_skills,
    )
