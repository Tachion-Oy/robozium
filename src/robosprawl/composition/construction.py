"""Application construction for project agents and nested specialists.

This module owns paths, persistence sinks, and root/background wiring. The
Librarian itself is built by Roboz's public constructor.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Final, Sequence

from roboz import Agent
from roboz.agent import (
    BackgroundAgentCtx,
    SubagentCtx,
    run_background_agent,
    run_subagent,
)
from roboz.llm import EndpointLike
from roboz.runtime import Output
from roboz.runtime.events import EventSink
from roboz.runtime.pipe import EventPipe
from roboz.skill import Skill
from roboz.tooling import Tool

from robosprawl.composition.runtime_sinks import (
    resolve_event_sinks,
    resolve_interaction_mode,
)
from robosprawl.identifiers import START_BACKGROUND_AGENT_TOOL_NAME
from robosprawl.workspace import (
    Project,
    Sandbox,
    WorkspacePermissions,
    build_workspace_permissions,
)

#: The ``Project.subdirs`` keys that hold the persistence tier. Fixed, not
#: configurable: the tier is the memory system's substrate, so its contract with
#: the project layout is part of the system, not a per-deployment knob.
_LOGS_KEY: Final[str] = "logs"
_SNAPSHOTS_KEY: Final[str] = "snapshots"
_MEMORY_KEY: Final[str] = "memory"


@dataclass(frozen=True)
class PersistencePaths:
    """The resolved storage tier the memory system depends on.

    Mandatory and encapsulated: the persistence sinks write here and the
    librarian scans and consolidates here, so every project carries a fully
    populated instance. This is deliberately *not* an injection point - it is
    the substrate, not a per-deployment option.
    """

    logs_root: Path
    snapshots_root: Path
    memory_root: Path

    def agent_log_dir(self, agent_name: str) -> Path:
        """Where ``agent_name`` writes its conversation logs."""
        return self.logs_root / agent_name

    @classmethod
    def from_project(
        cls, project: Project, *, logs_root: Path | None = None
    ) -> PersistencePaths:
        return cls(
            logs_root=(logs_root or getattr(project, _LOGS_KEY)).resolve(),
            snapshots_root=getattr(project, _SNAPSHOTS_KEY).resolve(),
            memory_root=getattr(project, _MEMORY_KEY).resolve(),
        )


@dataclass(frozen=True)
class ProjectPaths:
    """Resolved per-project locations any constructor may need.

    The persistence tier is a required, encapsulated member; user-facing
    artifact folders (code-task plans, sales decks, ...) are open-ended and
    resolved on demand via :meth:`artifact_dir`, never enumerated here.
    """

    sandbox: Sandbox
    project_root: Path
    base_dir: Path
    slug: str
    persistence: PersistencePaths

    def artifact_dir(self, name: str) -> Path:
        """A domain output folder under the project root.

        Optional and open-ended: any agent that emits artifacts asks for its
        folder by name (``"code_task_plans"``, ``"sales_decks"``, ...). Adding a
        new kind is one field on the agent that produces it - nothing here
        changes. Containment under the project root is enforced.
        """
        folder = (self.project_root / name).resolve()
        if not folder.is_relative_to(self.project_root):
            raise ValueError("artifact folder must be inside the project root")
        return folder

    @classmethod
    def from_project(
        cls, project: Project, *, logs_root: Path | None = None
    ) -> ProjectPaths:
        return cls(
            sandbox=project.sandbox,
            project_root=project.root.resolve(),
            base_dir=project.base_dir,
            slug=project.slug,
            persistence=PersistencePaths.from_project(project, logs_root=logs_root),
        )


@dataclass(frozen=True)
class BuildContext:
    """Everything injected at build time; constructor specs never carry these.

    ``event_sinks`` holds caller extras only - built-in sinks are resolved per
    agent inside :meth:`AgentConstructor.build`, so children never inherit the
    parent's file sinks. ``background_agents`` is read only by the root
    agent; it rides along here so ``build(ctx)`` stays uniform across chat
    agents, subagents, and daemons. ``deployment_agent_names`` is the set of
    conversation-writing agents a daemon may need to watch.
    """

    paths: ProjectPaths
    event_sinks: tuple[EventSink, ...] = ()
    interaction_mode: Output | None = None
    include_cli_output: bool = True
    background_agents: tuple[Agent, ...] = ()
    deployment_agent_names: frozenset[str] = frozenset()

    def for_child(self) -> BuildContext:
        """Context for a nested agent: same surroundings, no root-only extras."""
        return replace(self, background_agents=(), deployment_agent_names=frozenset())


class CancellationProbe:
    """Two-phase cancellation binding for tools built before their agent.

    Tools receive :meth:`is_cancelled` at construction; :meth:`bind` attaches
    the agent's pipe once the agent exists. Unbound, the probe reports not
    cancelled. Mutable by design - the two phases are the point.
    """

    def __init__(self) -> None:
        self._pipe: EventPipe | None = None

    def is_cancelled(self) -> bool:
        return self._pipe is not None and self._pipe.cancelled

    def bind(self, pipe: EventPipe) -> None:
        self._pipe = pipe


@dataclass(frozen=True)
class ToolSurface:
    """One agent's complete tool wiring, produced by a single hook call.

    Chain dispatch in roboz matches tools by instance identity, so a tool that
    participates in a chain *and* runs as a default tool must be the same
    object in both sequences - which is why the surface is built in one place.
    ``tools`` are agent-selectable (may contain tool chains); ``default_tools``
    run automatically each turn and are a daemon's entire behavior.
    """

    tools: tuple[Tool | Sequence[Tool], ...] = ()
    default_tools: tuple[Tool, ...] = ()


@dataclass(frozen=True)
class SubAgentSpec:
    """A nested agent exposed to its parent as an invocable tool."""

    constructor: "AgentConstructor"
    tool_name: str
    tool_description: str


@dataclass(frozen=True)
class RootAgentBundle:
    """The deployable unit: the root agent plus its background agents.

    Background agents are constructed up front so their pipes can be cancelled
    by the host, but they are started by the root agent via its
    ``start_background_agent_*`` tools.
    """

    agent: Agent
    background_agents: tuple[Agent, ...] = ()


class AgentConstructor(ABC):
    """The definition of an agent constructor.

    :meth:`build` is the one and only assembly sequence - subclasses must not
    override it. Reading this class top to bottom is reading the whole
    construction lifecycle: resolve runtime plumbing, create the cancellation
    probe, assemble the :class:`roboz.Agent` from the named hooks, bind the
    probe to the agent's pipe, run :meth:`post_build`. Concrete constructors
    are frozen dataclasses whose fields are domain configuration only.
    """

    agent_name: str

    def build(self, ctx: BuildContext) -> Agent:
        """Construct the agent. Final - override the hooks, not this.

        Resolves this agent's event sinks and dispatch pipe (the hooks wire
        tools against that pipe), creates the cancellation probe, assembles the
        :class:`roboz.Agent` from the named hooks, binds the probe to the
        agent's own pipe, and runs :meth:`post_build`.
        """
        event_sinks = resolve_event_sinks(
            data_path=ctx.paths.persistence.agent_log_dir(self.agent_name),
            include_cli=ctx.include_cli_output,
            event_sinks=ctx.event_sinks,
        )
        pipe = EventPipe(event_sinks=event_sinks)
        probe = CancellationProbe()
        agentic = self.is_agentic()
        surface = self.tool_surface(ctx, pipe, probe)
        interaction_mode = resolve_interaction_mode(
            interaction_mode=ctx.interaction_mode
        )
        interaction_mode = None if not agentic else interaction_mode

        agent = Agent(
            name=self.agent_name,
            description=self.description(),
            interaction_mode=interaction_mode,
            event_pipe=pipe,
            agent_endpoint=self.endpoint() if agentic else None,
            is_agentic=agentic,
            automatic_tool_prompt=agentic,
            tools=list(surface.tools),
            default_tools=list(surface.default_tools),
            skills=list(self.skills(ctx, pipe)),
            auto_loaded_skills=list(self.auto_loaded_skills(ctx)),
            initial_messages=self.initial_messages(ctx),
            system_prompt=self.system_prompt(),
        )
        probe.bind(agent.pipe)
        self.post_build(agent, ctx)
        return agent

    # --- required hooks: every agent constructor must answer these ---

    @abstractmethod
    def description(self) -> str:
        """The ``Agent.description`` shown to parents and prompts."""

    @abstractmethod
    def is_agentic(self) -> bool:
        """Whether an LLM drives the loop (chat agent) or not (daemon)."""

    @abstractmethod
    def endpoint(self) -> EndpointLike | None:
        """The LLM endpoint for agentic constructors; ``None`` for daemons."""

    @abstractmethod
    def tool_surface(
        self, ctx: BuildContext, pipe: EventPipe, probe: CancellationProbe
    ) -> ToolSurface:
        """The agent's complete tool wiring - selectable tools and defaults.

        ``pipe`` is this agent's resolved event dispatcher; tools wire against
        it. Built in one call so chained tools that also run as defaults can
        share the instance identity that roboz's chain dispatch requires.
        """

    @abstractmethod
    def system_prompt(self) -> str:
        """The agent's system prompt; empty string for daemons."""

    # --- optional hooks with defaults ---

    def skills(self, ctx: BuildContext, pipe: EventPipe) -> Sequence[Skill]:
        """Skills the agent may load on demand."""
        return ()

    def auto_loaded_skills(self, ctx: BuildContext) -> Sequence[Skill]:
        """Skills injected into every session."""
        return ()

    def initial_messages(self, ctx: BuildContext) -> Sequence[Path | str] | None:
        """Messages (or files) seeded at the start of each session."""
        return None

    def post_build(self, agent: Agent, ctx: BuildContext) -> None:
        """Optional final adjustment once the agent exists."""

    # --- shared machinery, implemented once ---

    def _subagent_tools(
        self, specs: Sequence[SubAgentSpec], ctx: BuildContext
    ) -> list[Tool]:
        """Nested agents wrapped as invocable tools."""
        return [
            run_subagent(SubagentCtx(spec.constructor.build(ctx.for_child()))).copy(
                name=spec.tool_name, description=spec.tool_description
            )
            for spec in specs
        ]

    def _background_agent_tools(self, ctx: BuildContext) -> list[Tool]:
        """Start-tools for the deployment's background agents."""
        return [
            run_background_agent(BackgroundAgentCtx(agent)).copy(
                name=f"{START_BACKGROUND_AGENT_TOOL_NAME}_{agent.name}"
            )
            for agent in ctx.background_agents
        ]

    def _workspace_permissions(self, ctx: BuildContext) -> WorkspacePermissions:
        """Ensure the sandbox and derive this project's permission rules."""
        ctx.paths.sandbox.ensure(ctx.paths.slug)
        return build_workspace_permissions(
            sandbox=ctx.paths.sandbox, agent_name=ctx.paths.slug
        )


class AgenticConstructor(AgentConstructor):
    """A chat agent: LLM-driven, endpoint required via the ``endpoint`` hook."""

    def is_agentic(self) -> bool:
        return True
