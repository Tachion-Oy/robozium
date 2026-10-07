"""Copy this package to root local/ to register private capabilities."""

from robozium.hub.local import LocalTool

CAPABILITIES: tuple[LocalTool, ...] = (
    LocalTool("example_skill:ExampleSkill", "requirements.txt"),
)
