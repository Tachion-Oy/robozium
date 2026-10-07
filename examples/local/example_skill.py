"""A selectable skill whose tool is bound to the current project at build time."""

from typing import cast

from roboz.deployment import Capability, DeployableAgent, SkillLabel
from roboz.models import Empty, Message
from roboz.runtime import EventPipe
from roboz.shed.sandbox import Sandbox
from roboz.skill import Skill
from roboz.tooling.decorators import factory


class ProjectName(Empty):
    project: str | None


@factory
def local_project_name(
    input: Empty, messages: list[Message], ctx: Sandbox
) -> ProjectName:
    """Return the name of the current project."""
    return ProjectName(project=ctx.scope)


class ExampleSkill(Capability):
    """Offer project information on demand without creating files."""

    def __init__(self) -> None:
        super().__init__(label=SkillLabel("local_example", selectable=True))

    @property
    def required_attributes(self) -> dict[str, type[object]]:
        return {"sandbox": Sandbox}

    def build(self, agent: DeployableAgent, pipe: EventPipe) -> tuple[Skill]:
        sandbox = cast(Sandbox, agent.sandbox)
        return (
            Skill(
                name="local_example",
                description="Find the name of the current project.",
                instructions="Use local_project_name to identify the current project.",
                tools=(local_project_name(sandbox),),
            ),
        )
