"""FastAPI three-endpoint smoke test with a minimal agent (no real LLM)."""

from __future__ import annotations

import asyncio
import importlib
import json
import time
from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Event
from types import SimpleNamespace

import pytest
from config_support import write_config
from deployment_support import BuiltAgents, configured_deployment
from fastapi import Request
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from roboshed.identifiers import LIBRARIAN_AGENT_NAME
from roboshed.sandbox import Sandbox
from roboshed.tools.memory_files import (
    TIMESTAMP_STEM_FORMAT,
    load_conversation_run,
    utc_now,
)
from roboz import Agent
from roboz.dependencies import LazyExternalDependency
from roboz.llm import LLMEndpoint, MockLLMEndpoint, MockTranscriptionEndpoint
from roboz.models import Empty, Message, Str
from roboz.runtime import Output
from roboz.runtime.events import (
    EventSink,
    MessageEvent,
    RuntimeEvent,
    ScriptOutputEvent,
)
from roboz.runtime.persistence import (
    ConversationRun,
    clear_conversation_active,
    mark_conversation_active,
    utc_iso_z,
)
from roboz.runtime.pipe import EventPipe
from roboz.tooling import Ctx
from roboz.tooling.decorators import tool
from roboz.tools import prompt_user_at_start, stop

from robosprawl.api.app import create_app
from robosprawl.api.projects import Project
from robosprawl.api.state import RunStatus
from robosprawl.hub.application import Hub
from robosprawl.hub.utils import load_hub
from robosprawl.mock.agents import mock_deployment

TEST_PROJECT_SLUG = "alpha"
UNMANIFESTED_PROJECT_SLUG = "unmanifested-project"


def _root_bundle(agent: Agent) -> BuiltAgents:
    return BuiltAgents(agent=agent, background_agents=())


def _test_deployment(
    factory: Callable[..., tuple[Agent, tuple[Agent, ...]]], config_start: Path
) -> Hub:
    return replace(
        load_hub(start=config_start),
        deployment=factory,
        transcription_endpoint=MockTranscriptionEndpoint(["unused"]),
    )


@tool
def entry(input: Empty, messages: list[Message]) -> Str:
    return Str(value="question")


@tool
def pause(input: Empty, messages: list[Message]) -> Str:
    del input, messages
    time.sleep(1.0)
    return Str(value="paused")


def _minimal_factory(
    sandbox: Sandbox,
    project_slug: str,
    /,
    *,
    endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
    event_sinks: Sequence[EventSink],
) -> BuiltAgents:
    del sandbox, project_slug, endpoint_getter
    endpoint = MockLLMEndpoint(
        responses=[
            {"action": "entry", "rationale": "ask"},
            {"action": "stop", "rationale": "done", "value": "ok"},
        ]
    )
    start_only = prompt_user_at_start(Ctx(message="m"))
    return _root_bundle(
        Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="api_http_test",
            tools=[entry, stop],
            system_prompt="API HTTP test agent.",
            default_tools=[start_only],
            custom_prompt_user_tool=None,
            agent_endpoint=endpoint,
            initial_messages=None,
        )
    )


def _running_factory(
    sandbox: Sandbox,
    project_slug: str,
    /,
    *,
    endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
    event_sinks: Sequence[EventSink],
) -> BuiltAgents:
    del sandbox, project_slug, endpoint_getter
    endpoint = MockLLMEndpoint(
        responses=[
            {"action": "pause", "rationale": "keep running briefly"},
            {"action": "stop", "rationale": "done", "value": "ok"},
        ]
    )
    return _root_bundle(
        Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="api_running_test",
            tools=[pause, stop],
            system_prompt="API running-state test agent.",
            agent_endpoint=endpoint,
            initial_messages=None,
        )
    )


def _stream_terminating_factory(
    sandbox: Sandbox,
    project_slug: str,
    /,
    *,
    endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
    event_sinks: Sequence[EventSink],
) -> BuiltAgents:
    del sandbox, project_slug, endpoint_getter
    endpoint = MockLLMEndpoint(
        responses=[
            {"action": "stop", "rationale": "done", "value": "ok"},
        ]
    )
    return _root_bundle(
        Agent(
            interaction_mode=Output.API,
            event_sinks=event_sinks,
            name="api_stream_terminating_test",
            tools=[stop],
            system_prompt="API stream terminating test agent.",
            agent_endpoint=endpoint,
            initial_messages=None,
        )
    )


def _syncing_after_stop_factory(
    sandbox: Sandbox,
    project_slug: str,
    /,
    *,
    endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
    event_sinks: Sequence[EventSink],
) -> BuiltAgents:
    del sandbox, project_slug, endpoint_getter
    root = Agent(
        interaction_mode=Output.API,
        event_sinks=event_sinks,
        name="api_syncing_root",
        tools=[stop],
        system_prompt="Completes immediately.",
        agent_endpoint=MockLLMEndpoint(
            responses=[{"action": "stop", "rationale": "done", "value": "ok"}]
        ),
        initial_messages=None,
    )
    background = Agent(
        interaction_mode=Output.API,
        name=LIBRARIAN_AGENT_NAME,
        tools=[stop],
        system_prompt="stub background agent",
        agent_endpoint=MockLLMEndpoint(responses=[]),
    )
    return BuiltAgents(agent=root, background_agents=(background,))


@pytest.fixture(autouse=True)
def _isolated_hub_config(tmp_path: Path) -> None:
    """Write an isolated hub config under ``tmp_path``.

    Tests point the app at it with ``create_app(deployment=Hub(load_hub(start=tmp_path)))``; nothing
    relies on the process working directory.
    """
    write_config(tmp_path)


def _create_run(client: TestClient, payload: dict[str, object] | None = None):
    project = TEST_PROJECT_SLUG
    if payload is not None and isinstance(payload.get("project"), str):
        project = payload["project"]
    assert client.post("/projects", json={"name": project}).status_code == 200
    body = {"project": project}
    if payload is not None:
        body.update(payload)
    return client.post("/run/create", json=body)


def _write_agent_run_log(
    project: Project,
    *,
    agent_name: str,
    status: str,
    conversation_id: str = "conv-1",
    started_at: datetime | None = None,
) -> None:
    started = started_at or datetime.now(timezone.utc)
    run = ConversationRun(
        conversation_id=conversation_id,
        agent_name=agent_name,
        started_at=utc_iso_z(started),
        ended_at=None if status == "running" else utc_iso_z(datetime.now(timezone.utc)),
        status=status,  # type: ignore[arg-type]
    )
    target = project.logs / agent_name / f"{conversation_id}.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(run.model_dump_json(), encoding="utf-8")
    if status == "running":
        mark_conversation_active(
            agent_dir=target.parent, conversation_id=run.conversation_id
        )
    else:
        clear_conversation_active(
            agent_dir=target.parent, conversation_id=run.conversation_id
        )


def _write_snapshot_memory_artifacts(project: Project) -> None:
    now = utc_now()
    project.memory.mkdir(parents=True, exist_ok=True)
    project.snapshots.mkdir(parents=True, exist_ok=True)
    (
        project.memory
        / f"{(now - timedelta(hours=1)).strftime(TIMESTAMP_STEM_FORMAT)}.md"
    ).write_text("old memory", encoding="utf-8")
    snapshot = (
        project.snapshots / "conv-1" / f"{now.strftime(TIMESTAMP_STEM_FORMAT)}.md"
    )
    snapshot.parent.mkdir(parents=True, exist_ok=True)
    snapshot.write_text(
        "# Conversation Snapshot: orchestrator\n\nnew",
        encoding="utf-8",
    )


def test_models_get_and_post_update_process_selection(tmp_path: Path) -> None:
    application = create_app(deployment=load_hub(start=tmp_path))
    client = TestClient(application)

    initial = client.get("/models")
    assert initial.status_code == 200
    assert initial.json() == {
        "models": [
            {
                "model_id": "model:openrouter:z-ai/glm-5.3",
                "label": "GLM-5.3 · OpenRouter",
            },
            {
                "model_id": "model:openrouter:z-ai/glm-5.3-flash",
                "label": "GLM-5.3 Flash · OpenRouter",
            },
            {
                "model_id": "model:cerebras:gpt-oss-120b",
                "label": "GPT-OSS-120B · Cerebras",
            },
        ],
        "selected_model_id": "model:openrouter:z-ai/glm-5.3",
    }

    selected = client.post("/models", json={"model_id": "model:cerebras:gpt-oss-120b"})
    assert selected.status_code == 200
    assert selected.json()["selected_model_id"] == "model:cerebras:gpt-oss-120b"
    assert client.get("/models").json()["selected_model_id"] == (
        "model:cerebras:gpt-oss-120b"
    )


def test_models_post_rejects_unknown_id_without_changing_selection(
    tmp_path: Path,
) -> None:
    application = create_app(deployment=load_hub(start=tmp_path))
    client = TestClient(application)

    response = client.post("/models", json={"model_id": "model:unknown"})

    assert response.status_code == 400
    assert response.json() == {"detail": "unknown model_id"}
    assert client.get("/models").json()["selected_model_id"] == (
        "model:openrouter:z-ai/glm-5.3"
    )


def test_model_selection_is_snapshotted_and_scoped_per_run(tmp_path: Path) -> None:
    application = create_app(
        deployment=_test_deployment(_minimal_factory, tmp_path),
    )
    client = TestClient(application)

    first_run_id = _create_run(client, {"project": "first"}).json()["run_id"]
    selected = client.post("/models", json={"model_id": "model:cerebras:gpt-oss-120b"})
    assert selected.status_code == 200
    second_run_id = _create_run(client, {"project": "second"}).json()["run_id"]

    assert (
        client.get(f"/models?run_id={first_run_id}").json()["selected_model_id"]
        == "model:openrouter:z-ai/glm-5.3"
    )
    assert (
        client.get(f"/models?run_id={second_run_id}").json()["selected_model_id"]
        == "model:cerebras:gpt-oss-120b"
    )

    changed = client.post(
        "/models",
        json={
            "model_id": "model:openrouter:z-ai/glm-5.3-flash",
            "run_id": second_run_id,
        },
    )
    assert changed.status_code == 200
    assert changed.json()["selected_model_id"] == (
        "model:openrouter:z-ai/glm-5.3-flash"
    )
    assert (
        client.get(f"/models?run_id={first_run_id}").json()["selected_model_id"]
        == "model:openrouter:z-ai/glm-5.3"
    )
    assert client.get("/models").json()["selected_model_id"] == (
        "model:cerebras:gpt-oss-120b"
    )


def test_models_returns_not_found_for_unknown_run(tmp_path: Path) -> None:
    application = create_app(deployment=load_hub(start=tmp_path))
    client = TestClient(application)

    assert client.get("/models?run_id=missing").status_code == 404
    response = client.post(
        "/models",
        json={
            "model_id": "model:cerebras:gpt-oss-120b",
            "run_id": "missing",
        },
    )
    assert response.status_code == 404
    assert response.json() == {"detail": "unknown run_id"}


def test_api_start_get_reply_until_completed(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)

    r = _create_run(client)
    assert r.status_code == 200
    run_id = r.json()["run_id"]
    assert application.state.run_manager.start_run(run_id)

    deadline = time.monotonic() + 15.0
    prompt_id = None
    while time.monotonic() < deadline:
        g = client.get(f"/run/{run_id}")
        assert g.status_code == 200
        data = g.json()
        if data["status"] == "awaiting_user_input":
            prompt_id = data["current_prompt_id"]
            break
        if data["status"] in ("failed", "completed"):
            raise AssertionError(data)
        time.sleep(0.05)
    assert prompt_id is not None

    rep = client.post(f"/run/{run_id}/reply", json={"content": "from client"})
    assert rep.status_code == 200
    assert rep.json() == {"ok": True}

    while time.monotonic() < deadline:
        g = client.get(f"/run/{run_id}")
        assert g.status_code == 200
        data = g.json()
        if data["status"] in ("completed", "failed"):
            assert data["status"] == "completed"
            return
        time.sleep(0.05)
    raise AssertionError("run did not complete")


def test_api_unknown_run_404(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.get("/run/nonexistent").status_code == 404
    assert client.get("/run/nonexistent/stream").status_code == 404


def test_api_projects_lists_project_folders(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )

    assert client.get("/projects").json() == []

    projects_dir = load_hub(start=tmp_path).sandbox.projects_dir
    (projects_dir / "beta").mkdir(parents=True)
    (projects_dir / "alpha").mkdir()
    (projects_dir / "stray.txt").write_text("not a project", encoding="utf-8")

    response = client.get("/projects")
    assert response.status_code == 200
    assert response.json() == [
        {
            "slug": "alpha",
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        },
        {
            "slug": "beta",
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        },
    ]


def test_api_projects_reads_one_lifecycle_snapshot_not_conversation_history(
    tmp_path: Path, monkeypatch
) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    history_dir = project.logs / "orchestrator"
    history_dir.mkdir(parents=True, exist_ok=True)
    for index in range(500):
        (history_dir / f"legacy-{index}.json").write_text(
            "{not-needed-on-the-hot-path", encoding="utf-8"
        )

    app_module = importlib.import_module("robosprawl.api.project_service")
    original_activity_reader = app_module.active_marker_paths
    activity_reads: list[Path] = []

    def tracked_activity_reader(root: Path, agent_names):
        activity_reads.append(root)
        return original_activity_reader(root, agent_names)

    original_read_text = Path.read_text

    def reject_history_reads(path: Path, *args, **kwargs):
        if path.suffix == ".json" and "conversation_logs" in path.parts:
            raise AssertionError(f"conversation history read from hot path: {path}")
        return original_read_text(path, *args, **kwargs)

    monkeypatch.setattr(app_module, "active_marker_paths", tracked_activity_reader)
    monkeypatch.setattr(Path, "read_text", reject_history_reads)

    response = client.get("/projects")

    assert response.status_code == 200
    assert response.json()[0]["status"] == "dormant"
    assert activity_reads == [project.logs]


def test_api_projects_reports_syncing_from_running_librarian_log_without_live_run(
    tmp_path: Path,
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
    )

    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "syncing",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


@pytest.mark.parametrize("terminal_status", ["completed", "failed", "cancelled"])
def test_api_projects_reports_dormant_from_terminal_librarian_log_without_live_run(
    tmp_path: Path, terminal_status: str
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status=terminal_status,
    )

    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_projects_ignores_torn_librarian_json_without_crashing(
    tmp_path: Path,
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    torn = project.logs / LIBRARIAN_AGENT_NAME / "conv-1.json"
    torn.parent.mkdir(parents=True, exist_ok=True)
    torn.write_text("{not-json", encoding="utf-8")

    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_run_create_returns_409_while_librarian_is_running(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
    )

    response = client.post("/run/create", json={"project": TEST_PROJECT_SLUG})

    assert response.status_code == 409


def test_api_run_create_succeeds_when_librarian_log_is_terminal(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="completed",
    )

    response = client.post("/run/create", json={"project": TEST_PROJECT_SLUG})

    assert response.status_code == 200
    assert response.json()["run_id"]


def test_api_projects_live_run_status_takes_precedence_over_disk_artifacts(
    tmp_path: Path,
) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_snapshot_memory_artifacts(project)

    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")

    rows = client.get("/projects").json()
    assert rows[0]["slug"] == TEST_PROJECT_SLUG
    assert rows[0]["status"] == "awaiting_user_input"
    assert rows[0]["run_id"] == run_id


@pytest.mark.parametrize(
    ("target_status", "expected_project_status"),
    [
        (RunStatus.QUEUED, "running"),
        (RunStatus.RUNNING, "running"),
        (RunStatus.AWAITING_USER_INPUT, "awaiting_user_input"),
        (RunStatus.CANCELLING, "cancelling"),
    ],
)
def test_api_projects_live_status_wins_over_running_librarian_log(
    tmp_path: Path,
    target_status: RunStatus,
    expected_project_status: str,
) -> None:
    entered, release = Event(), Event()

    def constructing_factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        entered.set()
        assert release.wait(5)
        return _minimal_factory(
            sandbox,
            project_slug,
            endpoint_getter=endpoint_getter,
            event_sinks=event_sinks,
        )

    factory = (
        constructing_factory
        if target_status == RunStatus.CANCELLING
        else _running_factory
        if target_status == RunStatus.RUNNING
        else _minimal_factory
    )
    application = create_app(deployment=_test_deployment(factory, tmp_path))
    client = TestClient(application)
    manager = application.state.run_manager
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    try:
        if target_status != RunStatus.QUEUED:
            assert manager.start_run(run_id)
        if target_status == RunStatus.CANCELLING:
            assert entered.wait(2)
            assert manager.cancel(run_id)
        elif target_status in {RunStatus.RUNNING, RunStatus.AWAITING_USER_INPUT}:
            _wait_for_status(client, run_id, target_status.value)

        project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
        _write_agent_run_log(project, agent_name=LIBRARIAN_AGENT_NAME, status="running")
        rows = client.get("/projects").json()
        assert rows[0]["slug"] == TEST_PROJECT_SLUG
        assert rows[0]["status"] == expected_project_status
        assert rows[0]["run_id"] == run_id
    finally:
        release.set()
        assert manager.shutdown(timeout_s=5)


def test_api_projects_ignores_pending_snapshot_artifacts_without_live_run(
    tmp_path: Path,
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_snapshot_memory_artifacts(project)

    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_projects_reports_dormant_for_non_liveness_disk_artifacts(
    tmp_path: Path,
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    project.memory.mkdir(parents=True, exist_ok=True)
    (project.memory / "project_state.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "status": "syncing",
                "sync": {"status": "syncing"},
            }
        ),
        encoding="utf-8",
    )

    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_cancelled_project_transitions_from_cancelling_to_dormant(
    tmp_path: Path,
) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)

    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")
    assert client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel").status_code == 200
    _wait_for_status(client, run_id, "cancelled")

    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
        conversation_id="librarian-sync",
    )
    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "cancelling",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]

    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="completed",
        conversation_id="librarian-sync",
    )
    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_projects_reports_dormant_after_cancelled_run(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200

    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")

    response = client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    _wait_for_status(client, run_id, "cancelled")

    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]
    assert client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel").json() == {"ok": True}


def test_api_projects_cancel_syncing_project_without_run_id(tmp_path: Path) -> None:
    application = create_app(
        deployment=_test_deployment(_syncing_after_stop_factory, tmp_path),
    )
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200

    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "completed")

    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
        conversation_id="librarian-sync",
    )
    assert client.get("/projects").json() == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "syncing",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]

    response = client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert client.get("/projects").json()[0]["status"] == "cancelling"


def test_api_projects_cancel_succeeds_when_already_inactive(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200

    response = client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_api_cancel_awaiting_input_persists_cancelled_conversation_status(
    tmp_path: Path,
) -> None:
    application = create_app(deployment=_test_deployment(mock_deployment, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200

    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")
    assert client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel").json() == {"ok": True}
    _wait_for_status(client, run_id, "cancelled")

    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    orchestrator_logs = project.logs / "orchestrator"
    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        runs = [
            run
            for path in orchestrator_logs.rglob("*.json")
            if (run := load_conversation_run(path)) is not None
        ]
        if any(run.status == "cancelled" for run in runs):
            return
        time.sleep(0.05)
    raise AssertionError("persisted conversation status did not settle to cancelled")


def test_api_projects_reports_dormant_when_root_terminal_and_librarian_not_running(
    tmp_path: Path,
) -> None:
    application = create_app(
        deployment=_test_deployment(_syncing_after_stop_factory, tmp_path),
    )
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200

    run_id = client.post("/run/create", json={"project": TEST_PROJECT_SLUG}).json()[
        "run_id"
    ]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "completed")

    rows = client.get("/projects").json()
    assert len(rows) == 1
    row = rows[0]
    assert row["slug"] == TEST_PROJECT_SLUG
    assert row["status"] == "dormant"
    assert row["run_id"] is None
    assert row["current_agent_name"] is None
    assert row["created_at"] is None
    stream = client.get(f"/run/{run_id}/stream")
    assert stream.status_code == 409
    assert "finished" in stream.json()["detail"]


def test_api_run_view_exposes_project_slug_without_public_run_list(
    tmp_path: Path,
) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)

    run_id = _create_run(client).json()["run_id"]

    view = client.get(f"/run/{run_id}")
    assert view.status_code == 200
    assert view.json()["project"] == TEST_PROJECT_SLUG

    assert client.get("/runs").status_code == 404


def test_api_reply_without_active_prompt_returns_400(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)

    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        g = client.get(f"/run/{run_id}")
        assert g.status_code == 200
        data = g.json()
        if data["status"] in ("completed", "failed"):
            break
        if data["status"] == "awaiting_user_input":
            # Unblock once so the run can finish; this keeps the "no active prompt" check deterministic.
            client.post(f"/run/{run_id}/reply", json={"content": "finish"})
        time.sleep(0.05)

    resp = client.post(f"/run/{run_id}/reply", json={"content": "too late"})
    assert resp.status_code == 400
    assert "awaiting user input" in resp.json()["detail"]


def test_minimal_run_emits_message_events_to_run_event_listeners(
    tmp_path: Path,
) -> None:
    """Sanity-check that MessageEvent reaches listeners subscribed to the hub run."""
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    manager = application.state.run_manager
    collected: list[object] = []
    capture = lambda ev: collected.append(ev)  # noqa: E731
    manager.subscribe_event_listener(run_id, capture)
    try:
        assert manager.start_run(run_id)
        reply_deadline = time.monotonic() + 15.0
        while time.monotonic() < reply_deadline:
            view = manager.run_view(run_id)
            if view is None:
                break
            if view["status"] == "awaiting_user_input":
                manager.submit_reply(
                    run_id, view["current_prompt_id"], "from pipe test"
                )
                break
            if view["status"] in ("completed", "failed"):
                break
            time.sleep(0.05)

        end = time.monotonic() + 15.0
        while time.monotonic() < end:
            if any(isinstance(e, MessageEvent) for e in collected):
                return
            time.sleep(0.05)
        raise AssertionError(f"no MessageEvent observed: {collected!r}")
    finally:
        manager.unsubscribe_event_listener(run_id, capture)


def test_api_stream_autostarts_run_and_emits_first_event(tmp_path: Path) -> None:
    application = create_app(
        deployment=_test_deployment(_stream_terminating_factory, tmp_path),
    )
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]

    first_event: str | None = None
    with client.stream("GET", f"/run/{run_id}/stream") as response:
        assert response.status_code == 200
        for line in response.iter_lines():
            if line.startswith("data: "):
                first_event = line
                break

    assert first_event is not None
    view = application.state.run_manager.run_view(run_id)
    assert view is not None
    assert view["status"] == "completed"


def test_api_stream_logs_the_terminal_status(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app_module = importlib.import_module("robosprawl.api.app")
    records: list[tuple[str, dict[str, object]]] = []

    def capture_log(
        logger: object,
        level: int,
        message: str,
        data: dict[str, object],
        **kwargs: object,
    ) -> None:
        del logger, level, kwargs
        records.append((message, data))

    monkeypatch.setattr(app_module, "log_with_data", capture_log)
    application = create_app(
        deployment=_test_deployment(_stream_terminating_factory, tmp_path),
    )
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]

    response = client.get(f"/run/{run_id}/stream")

    assert response.status_code == 200
    finished = next(
        record for record in records if record[0].startswith("Stream finished:")
    )
    assert finished[1]["run_id"] == run_id
    assert finished[1]["reason"] == "terminal"
    assert run_id not in finished[0]


def test_api_stream_emits_keepalive_comment_while_idle(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    app_module = importlib.import_module("robosprawl.api.app")
    monkeypatch.setattr(app_module, "SSE_KEEPALIVE_INTERVAL_S", 0.05)
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]

    route = next(
        (
            r
            for r in application.routes
            if getattr(r, "path", None) == "/run/{run_id}/stream"
        ),
        None,
    )
    assert route is not None
    assert isinstance(route, APIRoute)

    async def _read_keepalive() -> bytes:
        request = Request(
            {
                "type": "http",
                "http_version": "1.1",
                "method": "GET",
                "scheme": "http",
                "path": f"/run/{run_id}/stream",
                "raw_path": f"/run/{run_id}/stream".encode("utf-8"),
                "query_string": b"",
                "headers": [],
                "client": ("testclient", 123),
                "server": ("testserver", 80),
                "app": application,
            }
        )
        response = await route.endpoint(run_id, request)
        assert response.status_code == 200
        iterator = response.body_iterator
        try:
            for _ in range(40):
                chunk = await asyncio.wait_for(iterator.__anext__(), timeout=0.5)
                if chunk == b": keepalive\n\n":
                    return chunk
        finally:
            await iterator.aclose()
        raise AssertionError("did not observe keepalive chunk from stream")

    assert asyncio.run(_read_keepalive()) == b": keepalive\n\n"


def test_api_startup_does_not_manifest_projects_or_start_daemons(
    tmp_path: Path,
) -> None:
    application = create_app(
        deployment=_test_deployment(_stream_terminating_factory, tmp_path),
    )
    load_hub(start=tmp_path).project(TEST_PROJECT_SLUG).root.mkdir(parents=True)

    with TestClient(application):
        assert (
            not load_hub(start=tmp_path)
            .project(UNMANIFESTED_PROJECT_SLUG)
            .root.exists()
        )

    assert not hasattr(application.state.run_manager, "_daemon_threads")


def test_api_startup_clears_pre_boot_librarian_marker(tmp_path: Path) -> None:
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    project.root.mkdir(parents=True)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
        started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )

    with TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    ) as client:
        rows = client.get("/projects").json()
    assert rows == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_startup_clears_pre_boot_orchestrator_marker(tmp_path: Path) -> None:
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    project.root.mkdir(parents=True)
    _write_agent_run_log(
        project,
        agent_name="orchestrator",
        status="running",
        started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )

    with TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    ) as client:
        rows = client.get("/projects").json()
    assert rows == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_startup_skips_torn_conversation_json(tmp_path: Path) -> None:
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    project.root.mkdir(parents=True)
    torn = project.logs / LIBRARIAN_AGENT_NAME / "broken.json"
    torn.parent.mkdir(parents=True, exist_ok=True)
    torn.write_text("{not-json", encoding="utf-8")

    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )

    rows = client.get("/projects").json()
    assert rows == [
        {
            "slug": TEST_PROJECT_SLUG,
            "status": "dormant",
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_api_project_create_manifests_root_without_starting_daemon(
    tmp_path: Path,
) -> None:
    application = create_app(
        deployment=_test_deployment(_stream_terminating_factory, tmp_path)
    )
    client = TestClient(application)

    response = client.post("/projects", json={"name": "My Project"})

    assert response.status_code == 200
    assert response.json() == {"slug": "my-project"}
    assert load_hub(start=tmp_path).project("My Project").root.is_dir()
    assert not load_hub(start=tmp_path).project("My Project").logs.exists()
    assert not hasattr(application.state.run_manager, "_daemon_threads")


def test_api_run_view_includes_agent_fields_and_message_trace(tmp_path: Path) -> None:
    application = create_app(
        deployment=_test_deployment(_stream_terminating_factory, tmp_path)
    )
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)

    deadline = time.monotonic() + 10.0
    while time.monotonic() < deadline:
        response = client.get(f"/run/{run_id}")
        assert response.status_code == 200
        data = response.json()
        if data["status"] in ("completed", "failed"):
            break
        time.sleep(0.05)
    else:
        raise AssertionError("run did not complete")

    assert data["status"] == "completed"
    assert data["current_agent_name"] is None
    assert data["parent_agent_name"] is None
    assert isinstance(data["message_trace"], list)
    assert len(data["message_trace"]) >= 1
    last = data["message_trace"][-1]
    assert last["type"] in ("message", "run_lifecycle")


def test_api_run_view_serializes_script_output_trace_entry(tmp_path: Path) -> None:
    event = ScriptOutputEvent(content="script line", sequence=0)

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter

        def invoke():
            for sink in event_sinks:
                sink(event)

        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=invoke))

    application = create_app(deployment=_test_deployment(factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "completed")

    response = client.get(f"/run/{run_id}")
    assert response.status_code == 200
    assert response.json()["message_trace"] == [
        {
            "type": "script_output",
            "sequence": 1,
            "payload": {"content": "script line"},
        }
    ]


def test_api_run_view_serializes_runtime_event_trace_entry(tmp_path: Path) -> None:
    event = RuntimeEvent(
        category="llm",
        kind="failed",
        level="error",
        message="provider auth error",
        sequence=0,
        agent_name="root",
        data={"error_kind": "auth"},
    )

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter

        def invoke():
            for sink in event_sinks:
                sink(event)

        return BuiltAgents(SimpleNamespace(pipe=EventPipe(), invoke=invoke))

    application = create_app(deployment=_test_deployment(factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "completed")

    response = client.get(f"/run/{run_id}")
    assert response.status_code == 200
    assert response.json()["message_trace"] == [
        {
            "type": "runtime_event",
            "sequence": 1,
            "payload": {
                "category": "llm",
                "kind": "failed",
                "level": "error",
                "message": "provider auth error",
                "agent_name": "root",
                "data": {"error_kind": "auth"},
            },
        }
    ]


def test_api_run_view_message_trace_respects_history_limit(
    tmp_path: Path, monkeypatch
) -> None:
    manager_module = importlib.import_module("robosprawl.api.run_manager")
    monkeypatch.setattr(manager_module, "MESSAGE_HISTORY_LIMIT", 1)
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)

    deadline = time.monotonic() + 15.0
    prompt_id: str | None = None
    while time.monotonic() < deadline:
        response = client.get(f"/run/{run_id}")
        assert response.status_code == 200
        data = response.json()
        if data["status"] == "awaiting_user_input":
            prompt_id = data["current_prompt_id"]
            break
        if data["status"] in ("failed", "completed"):
            raise AssertionError(data)
        time.sleep(0.05)
    assert prompt_id is not None
    assert (
        client.post(f"/run/{run_id}/reply", json={"content": "finish"}).status_code
        == 200
    )

    while time.monotonic() < deadline:
        response = client.get(f"/run/{run_id}")
        assert response.status_code == 200
        data = response.json()
        if data["status"] in ("completed", "failed"):
            break
        time.sleep(0.05)
    else:
        raise AssertionError("run did not complete")

    assert data["status"] == "completed"
    assert len(data["message_trace"]) <= 1


def _wait_for_status(client: TestClient, run_id: str, status: str) -> None:
    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        if client.get(f"/run/{run_id}").json()["status"] == status:
            return
        time.sleep(0.05)
    raise AssertionError(f"run did not reach {status}")


def test_api_cancel_unknown_project_returns_404(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/projects/nonexistent/cancel").status_code == 404


def test_api_interrupt_unknown_run_returns_404(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.post("/run/nonexistent/interrupt").status_code == 404


def test_api_interrupt_awaiting_input_returns_false(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")

    response = client.post(f"/run/{run_id}/interrupt")
    assert response.status_code == 200
    assert response.json() == {"ok": False}


def test_api_delete_unknown_project_returns_404(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    assert client.delete("/projects/never-manifested").status_code == 404


def test_api_delete_dormant_project_removes_folder(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    root = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG).root
    assert root.is_dir()

    response = client.delete(f"/projects/{TEST_PROJECT_SLUG}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert not root.exists()
    assert client.get("/projects").json() == []


def test_api_delete_project_with_running_librarian_returns_409(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    assert client.post("/projects", json={"name": TEST_PROJECT_SLUG}).status_code == 200
    project = load_hub(start=tmp_path).project(TEST_PROJECT_SLUG)
    _write_agent_run_log(
        project,
        agent_name=LIBRARIAN_AGENT_NAME,
        status="running",
    )
    assert client.get("/projects").json()[0]["status"] == "syncing"
    assert not application.state.run_manager.project_is_busy(TEST_PROJECT_SLUG)

    response = client.delete(f"/projects/{TEST_PROJECT_SLUG}")

    assert response.status_code == 409
    assert "active run" in response.json()["detail"]
    assert project.root.exists()


def test_api_delete_busy_project_returns_409(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")

    response = client.delete(f"/projects/{TEST_PROJECT_SLUG}")
    assert response.status_code == 409
    assert "active run" in response.json()["detail"]
    # Folder is left intact while a run is live.
    assert load_hub(start=tmp_path).project(TEST_PROJECT_SLUG).root.is_dir()


def test_api_cancel_then_delete_flow(tmp_path: Path) -> None:
    application = create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)
    _wait_for_status(client, run_id, "awaiting_user_input")

    assert client.post(f"/projects/{TEST_PROJECT_SLUG}/cancel").json() == {"ok": True}
    _wait_for_status(client, run_id, "cancelled")
    stream = client.get(f"/run/{run_id}/stream")
    assert stream.status_code == 409
    assert "finished" in stream.json()["detail"]

    # Delete is gated on the worker thread fully unwinding; poll past any brief
    # window where it is still alive (409) until it settles.
    deadline = time.monotonic() + 15.0
    response = client.delete(f"/projects/{TEST_PROJECT_SLUG}")
    while response.status_code == 409 and time.monotonic() < deadline:
        time.sleep(0.05)
        response = client.delete(f"/projects/{TEST_PROJECT_SLUG}")
    assert response.status_code == 200
    assert not load_hub(start=tmp_path).project(TEST_PROJECT_SLUG).root.exists()


def test_api_run_create_requires_project_field(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )

    response = client.post("/run/create", json={})

    assert response.status_code == 422


def test_api_run_create_returns_404_for_unknown_project(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )

    response = client.post(
        "/run/create",
        json={"project": "does-not-exist"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "unknown project"


def test_api_run_create_returns_400_for_unsluggable_project(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )

    response = client.post(
        "/run/create",
        json={"project": "東京"},
    )

    assert response.status_code == 400
    assert "slug-safe" in response.json()["detail"]


def test_api_files_get_serves_hub_file_with_safe_headers(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    file_path = base_dir / "projects" / "alpha" / "documents" / "cv.txt"
    file_path.parent.mkdir(parents=True)
    file_path.write_text("updated cv", encoding="utf-8")

    response = client.get("/files/projects/alpha/documents/cv.txt")

    assert response.status_code == 200
    assert response.text == "updated cv"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-disposition"].startswith("inline;")
    assert response.headers["content-type"].startswith("text/plain")


def test_api_files_get_serves_pdf_with_inferred_content_type(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    file_path = base_dir / "projects" / "alpha" / "documents" / "cv.pdf"
    file_path.parent.mkdir(parents=True)
    file_path.write_bytes(b"%PDF-1.4\n%mock pdf\n")

    response = client.get("/files/projects/alpha/documents/cv.pdf")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/pdf")
    assert response.headers["content-disposition"].startswith("inline;")


def test_api_files_get_allows_reads_outside_projects_within_hub_root(
    tmp_path: Path,
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    file_path = base_dir / "shared" / "templates" / "cover-letter.txt"
    file_path.parent.mkdir(parents=True)
    file_path.write_text("shared template", encoding="utf-8")

    response = client.get("/files/shared/templates/cover-letter.txt")

    assert response.status_code == 200
    assert response.text == "shared template"


def test_api_files_get_serves_trusted_timesheet_artifact(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    relative = "readonly/Tachion/planning/Tunnit/timesheet_2026-08.csv"
    file_path = load_hub(start=tmp_path).sandbox.resolved_root / relative
    file_path.parent.mkdir(parents=True)
    file_path.write_text("Date,Hours\r\n2026-08-02,3.5\r\n", encoding="utf-8")

    response = client.get(f"/files/{relative}")

    assert response.status_code == 200
    assert response.text == "Date,Hours\r\n2026-08-02,3.5\r\n"
    assert response.headers["content-type"].startswith("text/csv")


def test_api_files_get_returns_file_not_found_diagnostic(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )

    response = client.get("/files/projects/missing/documents/cv.pdf")

    assert response.status_code == 404
    payload = response.json()
    assert payload["code"] == "file_not_found"
    assert payload["requested_path"] == "projects/missing/documents/cv.pdf"
    assert (
        payload["expected_tag"]
        == '<file src="projects/missing/documents/cv.pdf">Open generated file</file>'
    )
    assert "resolved_root" in payload
    assert "<file src" in payload["hint"]


def test_api_files_get_returns_not_a_file_diagnostic_for_directories(
    tmp_path: Path,
) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    folder = base_dir / "projects" / "alpha" / "documents"
    folder.mkdir(parents=True)

    response = client.get("/files/projects/alpha/documents")

    assert response.status_code == 404
    payload = response.json()
    assert payload["code"] == "not_a_file"
    assert payload["requested_path"] == "projects/alpha/documents"
    assert "concrete file" in payload["hint"].lower()


def test_api_files_get_rejects_empty_or_absolute_paths(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    (base_dir / "projects" / "alpha").mkdir(parents=True)

    empty_path_response = client.get("/files/%20")
    absolute_path_response = client.get("/files/%2Fetc%2Fpasswd")

    assert empty_path_response.status_code == 400
    assert absolute_path_response.status_code == 400
    assert empty_path_response.json()["code"] == "invalid_requested_path"
    assert absolute_path_response.json()["code"] == "invalid_requested_path"


def test_api_files_get_rejects_escape_outside_hub(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    (base_dir / "projects" / "alpha").mkdir(parents=True)
    external_file = base_dir.parent / "outside.txt"
    external_file.write_text("nope", encoding="utf-8")

    response = client.get("/files/projects/alpha/%2E%2E/%2E%2E/%2E%2E/outside.txt")

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "path_escape"
    assert "hub root directory" in payload["hint"]


def test_api_files_get_rejects_symlink_escape(tmp_path: Path) -> None:
    client = TestClient(
        create_app(deployment=_test_deployment(_minimal_factory, tmp_path))
    )
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    project_root = base_dir / "projects" / "alpha"
    project_root.mkdir(parents=True)
    external_file = base_dir.parent / "outside.txt"
    external_file.write_text("external", encoding="utf-8")
    (project_root / "external-link.txt").symlink_to(external_file)

    response = client.get("/files/projects/alpha/external-link.txt")

    assert response.status_code == 400
    payload = response.json()
    assert payload["code"] == "path_escape"
    assert payload["requested_path"] == "projects/alpha/external-link.txt"


def test_real_orchestrator_reads_top_level_workspace_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Drive the standard composition through HTTP to read a shared-area file.

    Both models are scripted and paths are isolated under the configured root.
    The transcript must contain the marker from outside the current project.
    """
    base_dir = load_hub(start=tmp_path).sandbox.resolved_root
    assert base_dir.is_relative_to(tmp_path.resolve()), base_dir  # writes stay in tmp

    marker = "ROBOZ-CV-MARKER-7F3A91"
    cv_file = base_dir / "workspace" / "CV" / "cv-marker.txt"
    cv_file.parent.mkdir(parents=True)
    cv_file.write_text(marker, encoding="utf-8")

    # Two scripted LLM turns: read the planted file, then stop. The real
    # orchestrator has no ask-at-start tool, so with this mock it never prompts the
    # user -- the run goes straight from the file read to completion.
    endpoint = MockLLMEndpoint(
        responses=[
            {
                "action": "run_file_command",
                "rationale": "read the CV marker the user asked about",
                "chain": "and",
                "file_commands": [
                    {"command": "cat", "argv": ["workspace/CV/cv-marker.txt"]}
                ],
            },
            {"action": "stop", "rationale": "done", "value": "read the CV"},
        ]
    )

    def orchestrator_factory(
        sandbox: Sandbox,
        project_slug: str,
        /,
        *,
        endpoint_getter: Callable[[], LazyExternalDependency[LLMEndpoint]],
        event_sinks: Sequence[EventSink],
    ) -> tuple[Agent, tuple[Agent, ...]]:
        del endpoint_getter
        return configured_deployment(
            Project(sandbox, project_slug), endpoint, event_sinks=event_sinks
        )

    application = create_app(
        deployment=_test_deployment(orchestrator_factory, tmp_path),
    )
    client = TestClient(application)
    run_id = _create_run(client).json()["run_id"]
    assert application.state.run_manager.start_run(run_id)

    # Poll until the run reaches a terminal status. "completed" and "failed" are
    # both terminal, so we stop on either, then assert it was the good one -- a
    # crashed run gives a clear assertion instead of a 20s timeout.
    deadline = time.monotonic() + 20.0
    view = client.get(f"/run/{run_id}").json()
    while view["status"] not in ("completed", "failed"):
        assert time.monotonic() < deadline, f"run did not finish: {view}"
        time.sleep(0.05)
        view = client.get(f"/run/{run_id}").json()

    assert view["status"] == "completed", view
    transcript = "\n".join(
        str(entry.get("payload", {}).get("content", ""))
        for entry in view["message_trace"]
    )
    assert marker in transcript, transcript


@pytest.mark.parametrize("operation", ["create", "run", "delete", "cancel"])
def test_project_operations_reject_shared_path_validation_errors(tmp_path, operation):
    config = load_hub(start=tmp_path)
    client = TestClient(
        create_app(deployment=_test_deployment(_stream_terminating_factory, tmp_path))
    )
    outside = tmp_path / "outside"
    outside.mkdir()
    config.sandbox.projects_dir.mkdir(parents=True)
    (config.sandbox.projects_dir / "escape").symlink_to(
        outside, target_is_directory=True
    )
    if operation == "create":
        response = client.post("/projects", json={"name": "escape"})
    elif operation == "run":
        response = client.post("/run/create", json={"project": "escape"})
    elif operation == "delete":
        response = client.delete("/projects/escape")
    else:
        response = client.post("/projects/escape/cancel")
    assert response.status_code == 400
    assert outside.is_dir() and not list(outside.iterdir())


def test_active_model_api_switch_changes_next_request_and_isolates_runs(
    tmp_path: Path,
) -> None:
    from robosprawl.mock.model_selection import MODEL_REQUESTS_FILE

    hub = _test_deployment(mock_deployment, tmp_path)
    application = create_app(deployment=hub)
    client = TestClient(application)
    manager = application.state.run_manager
    first, second, *_ = (endpoint.dependency_id for endpoint in hub.models.values())

    def start(slug):
        run_id = _create_run(client, {"project": slug}).json()["run_id"]
        project = hub.project(slug)
        (project.root / ".mock-scenario").write_text("model-selection")
        assert manager.start_run(run_id)
        return run_id, project.root / MODEL_REQUESTS_FILE

    def requests_at_prompt(run_id, journal, count):
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            state = client.get(f"/run/{run_id}").json()
            rows = (
                [json.loads(line) for line in journal.read_text().splitlines()]
                if journal.exists()
                else []
            )
            if len(rows) == count and state["status"] == "awaiting_user_input":
                return rows
            assert state["status"] not in ("failed", "completed"), state
            time.sleep(0.02)
        raise AssertionError("run did not reach scripted prompt")

    try:
        run_a, journal_a = start("model-first")
        assert requests_at_prompt(run_a, journal_a, 1)[0]["model_id"] == first
        assert client.post("/models", json={"model_id": second}).status_code == 200
        run_b, journal_b = start("model-second")
        assert requests_at_prompt(run_b, journal_b, 1)[0]["model_id"] == second
        for count, selected in enumerate((second, first), start=2):
            assert (
                client.post(
                    "/models", json={"model_id": selected, "run_id": run_a}
                ).status_code
                == 200
            )
            assert (
                client.post(
                    f"/run/{run_a}/reply", json={"content": "continue"}
                ).status_code
                == 200
            )
            rows = requests_at_prompt(run_a, journal_a, count)
            assert rows[-1]["model_id"] == selected
            assert rows[-1]["extra_body"] == {"reasoning": {"effort": "low"}}
        assert (
            client.post(f"/run/{run_b}/reply", json={"content": "continue"}).status_code
            == 200
        )
        assert [row["model_id"] for row in requests_at_prompt(run_b, journal_b, 2)] == [
            second,
            second,
        ]
        assert client.get("/models").json()["selected_model_id"] == second
    finally:
        assert manager.shutdown()
        client.close()
