import threading
import time
from pathlib import Path

from config_support import write_config
from roboshed.deployments.robosprawl import RoboSprawlBundle
from roboshed.identifiers import (
    CONSOLIDATE_MEMORY_TOOL_NAME,
    LIBRARIAN_AGENT_NAME,
    PURGE_LOGS_TOOL_NAME,
    PURGE_MEMORY_TOOL_NAME,
    PURGE_SNAPSHOTS_TOOL_NAME,
    SLEEP_BETWEEN_RUNS_TOOL_NAME,
    SNAPSHOT_CONVERSATIONS_TOOL_NAME,
)
from roboz.llm import MockLLMEndpoint, MockProviderError
from roboz_endpoints import openrouter

from robosprawl.hub.utils import load_hub
from robosprawl.mock.agents import (
    MOCK_SCENARIO_USER_NOTIFICATION,
    _holdable_endpoint,
    mock_deployment,
    stream_sync_mock_deployment,
)


def _endpoint_getter():
    return openrouter.z_ai__glm_5_3


def test_mock_librarian_is_non_agentic_workflow(tmp_path: Path) -> None:
    write_config(tmp_path, workspace="hub_data", name="MockHub")
    project = load_hub(start=tmp_path).project("alpha")

    (librarian,) = mock_deployment(
        project, endpoint_getter=_endpoint_getter, event_sinks=()
    ).background_agents

    assert librarian.name == LIBRARIAN_AGENT_NAME
    assert librarian.is_agentic is False
    assert librarian.is_agentic is False
    assert [tool.name for tool in librarian.default_tools] == [
        SNAPSHOT_CONVERSATIONS_TOOL_NAME,
        CONSOLIDATE_MEMORY_TOOL_NAME,
        PURGE_LOGS_TOOL_NAME,
        PURGE_SNAPSHOTS_TOOL_NAME,
        PURGE_MEMORY_TOOL_NAME,
        SLEEP_BETWEEN_RUNS_TOOL_NAME,
    ]


def test_mock_deployment_uses_background_agent_wiring(
    tmp_path: Path,
) -> None:
    write_config(tmp_path, workspace="hub_data", name="MockHub")
    project = load_hub(start=tmp_path).project("alpha")

    bundle = mock_deployment(project, endpoint_getter=_endpoint_getter, event_sinks=())

    assert isinstance(bundle, RoboSprawlBundle)
    assert len(bundle.background_agents) == 1
    assert bundle.background_agents[0].name == LIBRARIAN_AGENT_NAME
    assert not project.root.exists()
    assert [tool.name for tool in bundle.agent.default_tools] == [
        "prepare_mock_artifact",
        "start_background_agent_librarian",
    ]


def test_mock_deployment_selects_error_scenario_from_marker(
    tmp_path: Path,
) -> None:
    write_config(tmp_path, workspace="hub_data", name="MockHub")
    project = load_hub(start=tmp_path).project("alpha")
    project.root.mkdir(parents=True, exist_ok=True)
    (project.root / ".mock-scenario").write_text("llm-error", encoding="utf-8")

    orchestrator = mock_deployment(
        project, endpoint_getter=_endpoint_getter, event_sinks=()
    ).agent

    assert isinstance(orchestrator.agent_endpoint, MockLLMEndpoint)
    assert len(orchestrator.agent_endpoint.mock_responses) == 3
    assert isinstance(orchestrator.agent_endpoint.mock_responses[0], str)
    scripted_error = orchestrator.agent_endpoint.mock_responses[1]
    assert isinstance(scripted_error, MockProviderError)
    assert scripted_error.status_code == 401
    assert isinstance(orchestrator.agent_endpoint.mock_responses[2], str)


def test_mock_deployment_adds_notification_default_tool_for_scenario(
    tmp_path: Path,
) -> None:
    write_config(tmp_path, workspace="hub_data", name="MockHub")
    project = load_hub(start=tmp_path).project("notification")
    project.root.mkdir(parents=True, exist_ok=True)
    (project.root / ".mock-scenario").write_text(
        MOCK_SCENARIO_USER_NOTIFICATION, encoding="utf-8"
    )

    orchestrator = mock_deployment(
        project, endpoint_getter=_endpoint_getter, event_sinks=()
    ).agent

    assert [tool.name for tool in orchestrator.default_tools] == [
        "prepare_mock_artifact",
        "mock_user_notification",
        "start_background_agent_librarian",
    ]


def test_stream_sync_mock_factory_exposes_background_agent_for_syncing(
    tmp_path: Path,
) -> None:
    write_config(tmp_path, workspace="hub_data", name="MockHub")
    project = load_hub(start=tmp_path).project("alpha")

    bundle = stream_sync_mock_deployment(
        project, endpoint_getter=_endpoint_getter, event_sinks=()
    )

    assert isinstance(bundle, RoboSprawlBundle)
    assert len(bundle.background_agents) == 1
    assert bundle.background_agents[0].name == LIBRARIAN_AGENT_NAME


def test_holdable_endpoint_consumes_immediately_without_marker(tmp_path: Path) -> None:
    inner = MockLLMEndpoint([{"value": "x"}])
    endpoint = _holdable_endpoint(
        inner,
        hold_marker=tmp_path / ".librarian-hold",
        is_cancelled=lambda: False,
    )

    start = time.monotonic()
    endpoint.mock_responses.pop(0)
    assert time.monotonic() - start < 0.2


def test_holdable_endpoint_blocks_until_marker_removed(tmp_path: Path) -> None:
    inner = MockLLMEndpoint([{"value": "x"}])
    marker = tmp_path / ".librarian-hold"
    marker.write_text("", encoding="utf-8")
    endpoint = _holdable_endpoint(
        inner,
        hold_marker=marker,
        is_cancelled=lambda: False,
        max_hold_s=5.0,
    )

    result: dict[str, str | Exception] = {}

    def run() -> None:
        result["response"] = endpoint.mock_responses.pop(0)

    thread = threading.Thread(target=run)
    thread.start()
    time.sleep(0.15)
    assert "response" not in result

    marker.unlink()
    thread.join(timeout=2.0)
    assert "response" in result


def test_holdable_endpoint_aborts_when_cancelled(tmp_path: Path) -> None:
    inner = MockLLMEndpoint([{"value": "x"}])
    marker = tmp_path / ".librarian-hold"
    marker.write_text("", encoding="utf-8")
    cancelled = {"value": False}
    endpoint = _holdable_endpoint(
        inner,
        hold_marker=marker,
        is_cancelled=lambda: cancelled["value"],
        max_hold_s=5.0,
    )

    result: dict[str, str | Exception] = {}

    def run() -> None:
        result["response"] = endpoint.mock_responses.pop(0)

    thread = threading.Thread(target=run)
    thread.start()
    time.sleep(0.15)
    cancelled["value"] = True
    thread.join(timeout=2.0)
    assert "response" in result


def test_holdable_endpoint_can_hold_cancelled_teardown(tmp_path: Path) -> None:
    inner = MockLLMEndpoint([{"value": "x"}])
    cancel_marker = tmp_path / ".librarian-cancel-hold"
    cancel_marker.write_text("", encoding="utf-8")
    endpoint = _holdable_endpoint(
        inner,
        hold_marker=tmp_path / ".librarian-hold",
        cancel_hold_marker=cancel_marker,
        is_cancelled=lambda: True,
        max_hold_s=5.0,
    )

    result: dict[str, str | Exception] = {}

    def run() -> None:
        result["response"] = endpoint.mock_responses.pop(0)

    thread = threading.Thread(target=run)
    thread.start()
    time.sleep(0.15)
    assert "response" not in result

    cancel_marker.unlink()
    thread.join(timeout=2.0)
    assert "response" in result


def test_holdable_endpoint_honors_max_hold_s(tmp_path: Path) -> None:
    inner = MockLLMEndpoint([{"value": "x"}])
    marker = tmp_path / ".librarian-hold"
    marker.write_text("", encoding="utf-8")
    endpoint = _holdable_endpoint(
        inner,
        hold_marker=marker,
        is_cancelled=lambda: False,
        max_hold_s=0.1,
    )

    start = time.monotonic()
    endpoint.mock_responses.pop(0)
    assert time.monotonic() - start < 1.0


def test_stream_mock_repeats_specialist_and_recreates_scripts_per_run(
    tmp_path, monkeypatch
):
    from types import SimpleNamespace

    from roboz.runtime import bind_api_user_io, reset_api_user_io

    from robosprawl.mock.agents import stream_mock_deployment

    monkeypatch.setenv("ROBOSPRAWL_STREAM_MOCK_DELAY_S", "0")
    monkeypatch.setenv("ROBOSPRAWL_STREAM_MOCK_START_DELAY_S", "0")
    write_config(tmp_path, workspace="hub_data", name="MockHub")
    project = load_hub(start=tmp_path).project("stream")
    replies = []

    def reply(message, timeout=None):
        replies.append(message)
        return "continue"

    token = bind_api_user_io(
        SimpleNamespace(request_input=reply, notify=lambda message: None)
    )
    try:
        for _ in range(2):
            bundle = stream_mock_deployment(
                project,
                endpoint_getter=_endpoint_getter,
                event_sinks=(),
            )
            result, _ = bundle.agent.invoke()
            assert "end of the streaming mock walkthrough" in result.value
    finally:
        reset_api_user_io(token)
    assert len(replies) == 4
    assert len(list((project.logs / "hello_world").rglob("*.json"))) == 6
