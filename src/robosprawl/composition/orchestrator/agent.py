"""Application file assistant and its deliberately small capability set."""

from dataclasses import dataclass

from roboz import stop
from roboz.llm import EndpointLike
from roboz_shed.skills import cli_skill, file_editing
from roboz_shed.tools import get_apply_patch, get_run_file_command
from roboz_shed.tools.cli_commands.run_file_command import FILE_COMMANDS_READ

from robosprawl.composition.construction import (
    AgenticConstructor,
    SubAgentSpec,
    ToolSurface,
)


@dataclass(frozen=True)
class OrchestratorConstructor(AgenticConstructor):
    agent_endpoint: EndpointLike
    subagents: tuple[SubAgentSpec, ...] = ()
    compactify_threshold_percent: float = 60.0
    extra_default_tools: tuple | None = None
    seed_initial_messages_from_memory: bool = True
    auto_load_skills: bool = True
    agent_name: str = "orchestrator"

    def description(self):
        return "RoboSprawl project assistant with file tools and persistent memory."

    def endpoint(self):
        return self.agent_endpoint

    def system_prompt(self):
        return (
            "Help the user with their project using guarded file reading and patch editing. "
            "Ask the user for missing information and call stop when finished. "
            "A background Librarian maintains snapshots and persistent memory. "
            'Link artifacts using <file src="projects/project-slug/path">label</file>, '
            "with paths relative to the file tool base. No web, email, shell, or office integrations are available."
        )

    def tool_surface(self, ctx, pipe, probe):
        permissions = self._workspace_permissions(ctx)
        defaults = self.extra_default_tools
        if defaults is None:
            defaults = (
                self._compactify(
                    self.agent_endpoint, self.compactify_threshold_percent
                ),
            )
        return ToolSurface(
            tools=(
                *self._subagent_tools(self.subagents, ctx),
                get_run_file_command(
                    **permissions, pipe=pipe, command_specs=FILE_COMMANDS_READ
                ),
                get_apply_patch(**permissions, pipe=pipe),
                stop,
            ),
            default_tools=(*defaults, *self._background_agent_tools(ctx)),
        )

    def auto_loaded_skills(self, ctx):
        return (cli_skill, file_editing) if self.auto_load_skills else ()

    def initial_messages(self, ctx):
        return (
            [ctx.paths.persistence.memory_root]
            if self.seed_initial_messages_from_memory
            else None
        )

    def post_build(self, agent, ctx):
        paths = ctx.paths
        agent.system_prompt += (
            f"\nFile tool base: {paths.base_dir}. Project: {paths.slug}. "
            f"Your writable project directory is {paths.project_root}. "
            f"Read-only shared files are in {paths.sandbox.readonly_dir}; "
            f"writes in {paths.sandbox.workspace_dir} require user confirmation."
        )
