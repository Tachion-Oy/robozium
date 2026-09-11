"""Minimal deployment double for tests that supply controlled runtime agents."""

from dataclasses import replace
from typing import NamedTuple

from roboz.agent import Agent
from roboz.llm import MockLLMEndpoint

from robosprawl.hub.utils import load_hub


class BuiltAgents(NamedTuple):
    """Expose supplied agents through the deployment build boundary."""

    agent: Agent
    background_agents: tuple[Agent, ...] = ()

    def build(self) -> tuple[Agent, tuple[Agent, ...]]:
        return self.agent, self.background_agents


def configured_deployment(project, endpoint, **choices):
    """Use the real application composition with an explicit test endpoint."""
    hub = load_hub()
    choices.setdefault("memory_endpoint", MockLLMEndpoint([]))
    deployment = hub.deployment(
        project.sandbox,
        project.slug,
        endpoint_getter=lambda: hub.default_model,
        **choices,
    )
    return replace(deployment, agent=replace(deployment.agent, agent_endpoint=endpoint))
