from __future__ import annotations

from pathlib import Path
from typing import Sequence

from roboz.runtime import Output, default_event_sinks, get_bound_output
from roboz.runtime.events import EventSink


def resolve_event_sinks(
    *,
    data_path: Path | None,
    include_cli: bool,
    event_sinks: Sequence[EventSink] | None,
) -> tuple[EventSink, ...]:
    """Compose built-in sinks with optional caller-provided sinks."""
    builtins = default_event_sinks(
        data_path=None if data_path is None else data_path.resolve(),
        include_cli=include_cli,
    )
    extras = tuple(event_sinks or ())
    return (*builtins, *extras)


def resolve_interaction_mode(
    *,
    interaction_mode: Output | None,
) -> Output:
    """Resolve interaction mode, defaulting to the bound runtime output."""
    if interaction_mode is not None:
        return interaction_mode
    return get_bound_output(default=Output.CLI) or Output.CLI
