"""Protect runtime event serialization and validation at the HTTP boundary."""

import pytest
from pydantic import ValidationError
from roboz.runtime.observability import RuntimeEventLevel

from robozium.api.models import RunViewRuntimeEventPayload


@pytest.mark.parametrize("level", list(RuntimeEventLevel))
def test_runtime_levels_preserve_http_schema(level: RuntimeEventLevel) -> None:
    payload = RunViewRuntimeEventPayload(
        category="tool",
        kind="started",
        level=level,
        message="Started",
        agent_name="root",
    )
    assert payload.model_dump(mode="json")["level"] == level.value
    assert RunViewRuntimeEventPayload.model_json_schema()["properties"]["level"][
        "enum"
    ] == ["debug", "info", "warning", "error"]


def test_runtime_level_validation_is_not_weakened() -> None:
    with pytest.raises(ValidationError):
        RunViewRuntimeEventPayload.model_validate(
            {
                "category": "tool",
                "kind": "started",
                "level": "bogus",
                "message": "Started",
                "agent_name": "root",
            }
        )
