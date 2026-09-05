"""The agentic factory: composes constructors into a deployable root bundle."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from roboz import Agent
from roboz.runtime import Output
from roboz.runtime.events import EventSink
from roboz.tools.librarian import LibrarianConstructor, LibrarianPaths

from robosprawl.composition.construction import (
    BuildContext,
    ProjectPaths,
    RootAgentBundle,
)
from robosprawl.composition.orchestrator.agent import OrchestratorConstructor
from robosprawl.workspace import Project


@dataclass(frozen=True)
class AgenticFactory:
    """A deployment: the orchestrator, its librarian, and how they meet a project.

    Calling the factory with a :class:`Project` yields the
    :class:`RootAgentBundle` a host runtime drives - the call signature is the
    hub's ``AgentFactory`` protocol. Per-agent data paths and the librarian's
    monitored agent set are derived here, from the composition itself.
    """

    orchestrator: OrchestratorConstructor
    librarian: LibrarianConstructor | None = None
    include_cli_output: bool = False
    interaction_mode: Output | None = None
    logs_root_override: Path | None = None

    def agent_names(self) -> frozenset[str]:
        """Every conversation-writing agent in this deployment."""
        return frozenset(
            {
                self.orchestrator.agent_name,
                *(spec.constructor.agent_name for spec in self.orchestrator.subagents),
            }
        )

    def __call__(
        self, project: Project, /, *, event_sinks: Sequence[EventSink]
    ) -> RootAgentBundle:
        paths = ProjectPaths.from_project(project, logs_root=self.logs_root_override)
        background: tuple[Agent, ...] = ()
        if self.librarian is not None:
            background = (
                self.librarian.build(
                    paths=LibrarianPaths(
                        conversation_root=paths.persistence.logs_root,
                        snapshot_root=paths.persistence.snapshots_root,
                        memory_root=paths.persistence.memory_root,
                    ),
                    agent_names=self.agent_names(),
                    include_cli_output=False,
                ),
            )
        agent = self.orchestrator.build(
            BuildContext(
                paths=paths,
                event_sinks=tuple(event_sinks),
                interaction_mode=self.interaction_mode,
                include_cli_output=self.include_cli_output,
                background_agents=background,
            )
        )
        return RootAgentBundle(agent=agent, background_agents=background)
