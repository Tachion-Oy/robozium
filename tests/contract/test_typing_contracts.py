"""Protect the runtime contracts whose annotations are checked by CI."""

from pathlib import Path

import pytest
from pydantic import ValidationError
from roboz.runtime.observability import RuntimeEventLevel

from robosprawl.api.models import RunViewRuntimeEventPayload
from robosprawl.mock.agents import _HoldableResponses


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


def test_holdable_response_accepts_index_protocol(tmp_path: Path) -> None:
    class Index:
        def __index__(self) -> int:
            return 0

    responses = _HoldableResponses(
        ["first", "second"],
        hold_marker=tmp_path / "absent",
        cancel_hold_marker=None,
        is_cancelled=lambda: False,
        max_hold_s=0,
    )
    assert responses.pop(Index()) == "first"
    assert responses == ["second"]
