"""Private capability registration; launchers copy this file only when missing.

Uncomment the Simpsons import and entry below, then restart the API.
Your edited local/__init__.py and other private modules stay Git-ignored.
"""

from roboz.deployment import Capability

from robozium.hub.local import LocalTool

# from .simpsons import SIMPSONS

CAPABILITIES: tuple[Capability | LocalTool, ...] = (
    # SIMPSONS,
    # LocalTool("my_tool.capability:MyCapability", "my_tool/requirements.txt"),
)
