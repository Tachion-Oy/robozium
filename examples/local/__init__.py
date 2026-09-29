"""Copy this package to root local/ to register private capabilities."""

from robozium.hub.local import LocalTool

# For example, place code in local/my_tool/ with an empty requirements.txt:
# CAPABILITIES = (LocalTool("my_tool.capability:MyCapability", "my_tool/requirements.txt"),)
CAPABILITIES: tuple[LocalTool, ...] = ()
