"""Copy this package to root local/ and import private capabilities relatively."""

from roboz.deployment import AgentCapability

# For example: from .my_tools import MyCapability
# Then export CAPABILITIES = (MyCapability(),)
CAPABILITIES: tuple[AgentCapability, ...] = ()
