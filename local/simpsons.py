"""Register RoboZ's Simpsons example as an optional local capability."""

from roboz.deployment import Capability, ToolLabel
from roboz.examples.simple import get_quote

SIMPSONS = Capability(
    label=ToolLabel("simpsons_quotes", selectable=True),
    value=get_quote,
)
