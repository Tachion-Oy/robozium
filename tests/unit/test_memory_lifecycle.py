"""Test checks must preserve a running project's durable memory lifecycle."""

import json
import time
from dataclasses import replace
from threading import Event
from types import SimpleNamespace

import pytest
from config_support import write_config
from roboz.llm import LLMEndpoint
from roboz.runtime.persistence import active_marker_paths

from robozium.api.app import create_app
from robozium.api.errors import ProjectBusyError
from robozium.hub.utils import load_hub
from tests.support.mock_startup import check_mock_startup

USER_FACT = "Remember to group timesheet hours by client and week. USER-FACT-9342"
SNAPSHOT_FACT = "SNAPSHOT-FACT-9342: group timesheet hours by client and week."
MEMORY_FACT = "MEMORY-FACT-9342: group timesheet hours by client and week."


def _wait_until(condition):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if condition():
            return
        time.sleep(0.01)
    raise AssertionError("The expected run state did not settle")


def _endpoint(name, complete):
    return LLMEndpoint(
        client=SimpleNamespace(
            models=object(),
            close=lambda: None,
            chat=SimpleNamespace(completions=SimpleNamespace(create=complete)),
        ),
        api_name="test",
        model_name=name,
        stream=False,
    )


def _response(value):
    return SimpleNamespace(
        usage=None,
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(value)))],
    )


@pytest.mark.parametrize("inherited_paths", [False, True])
def test_mock_check_preserves_active_run_and_memory_after_restart(
    tmp_path, monkeypatch, inherited_paths
):
    # Reproduce main-checkout discovery with a synthetic sibling live hub.
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    config = write_config(checkout, sandbox_root="../Robozium-Hub")
    monkeypatch.chdir(checkout)
    if inherited_paths:
        monkeypatch.setenv("ROBOZIUM_CONFIG", str(config))
        monkeypatch.setenv("ROBOZIUM_HUB_ROOT", str(tmp_path / "Robozium-Hub"))
        monkeypatch.setenv("ROBOZIUM_LOG_DIR", str(checkout / "technical_logs"))
    else:
        for name in ("ROBOZIUM_CONFIG", "ROBOZIUM_HUB_ROOT", "ROBOZIUM_LOG_DIR"):
            monkeypatch.delenv(name, raising=False)
    isolated = tmp_path / "startup-check"
    isolated.mkdir()
    isolated_config = write_config(isolated)

    root_requests, memory_requests = [], []
    final_entered, final_release = Event(), Event()
    consolidation_entered, consolidation_release = Event(), Event()

    def root_complete(**request):
        root_requests.append(request)
        if len(root_requests) == 1:
            return _response(
                {
                    "action": "prompt_user",
                    "rationale": "ask",
                    "value": "What should I remember?",
                }
            )
        if len(root_requests) == 2:
            final_entered.set()
            assert final_release.wait(10), "Final response was not released"
        return _response({"action": "stop", "rationale": "done", "value": "Recorded."})

    def memory_complete(**request):
        memory_requests.append(request)
        if len(memory_requests) == 1:
            return _response({"value": "## Snapshot\n- " + SNAPSHOT_FACT})
        consolidation_entered.set()
        assert consolidation_release.wait(10), "Consolidation was not released"
        return _response({"value": "## Preferences\n- " + MEMORY_FACT})

    model = _endpoint("orchestrator", root_complete)
    hub = replace(
        load_hub(config_file=config),
        models={"Test": model},
        default_model=model,
        memory_endpoint=_endpoint("memory", memory_complete),
        additional_capabilities=(),
        subagents=(),
        transcription_endpoint=None,
        additional_dependencies=(),
    )
    app = create_app(deployment=hub)
    manager = app.state.run_manager
    projects = app.state.projects
    project = hub.project("timesheets")
    try:
        projects.create(project.slug)
        run_id = projects.prepare_run(project.slug, capabilities={})
        manager.start_run(run_id)
        _wait_until(lambda: manager.get_run(run_id)["status"] == "awaiting_user_input")
        manager.submit_reply(
            run_id, manager.get_run(run_id)["current_prompt_id"], USER_FACT
        )
        assert final_entered.wait(5)
        markers = active_marker_paths(project.logs, {"orchestrator"})
        assert len(markers) == 1

        # The exact startup check that previously erased the ongoing run's marker.
        check_mock_startup(isolated_config)
        assert all(marker.exists() for marker in markers)
        assert manager.get_run(run_id)["status"] == "running"
        assert list(project.snapshots.rglob("*.md")) == []
        assert list(project.memory.glob("*.md")) == []

        final_release.set()
        assert consolidation_entered.wait(5)
        _wait_until(lambda: manager.get_run(run_id)["status"] == "completed")
        assert list(project.memory.glob("*.md")) == []
        with pytest.raises(ProjectBusyError):
            projects.prepare_run(project.slug, capabilities={})

        consolidation_release.set()
        _wait_until(lambda: not manager.project_is_busy(project.slug))
        snapshots = list(project.snapshots.rglob("*.md"))
        memories = list(project.memory.glob("*.md"))
        assert len(snapshots) == len(memories) == 1
        assert SNAPSHOT_FACT in snapshots[0].read_text()
        assert MEMORY_FACT in memories[0].read_text()
        assert USER_FACT in json.dumps(memory_requests[0]["messages"])
        assert SNAPSHOT_FACT in json.dumps(memory_requests[1]["messages"])
        assert manager.shutdown()

        # A fresh application constructs fresh agents and loads generated memory.
        restarted = create_app(deployment=hub)
        manager = restarted.state.run_manager
        run_id = restarted.state.projects.prepare_run(project.slug, capabilities={})
        manager.start_run(run_id)
        _wait_until(lambda: manager.get_run(run_id)["status"] == "completed")
        _wait_until(lambda: not manager.project_is_busy(project.slug))
        assert MEMORY_FACT in json.dumps(root_requests[2]["messages"])
    finally:
        final_release.set()
        consolidation_release.set()
        assert manager.shutdown()
