"""Exercise the guarded CLI through the real deployment and HTTP approval flow."""

import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

import pytest
from config_support import write_config
from deployment_support import (
    BuiltAgents,
    configured_deployment,
    configured_hub,
    deferred_deployment,
    foreground_agent,
)
from fastapi.testclient import TestClient
from roboz.llm import MockLLMEndpoint
from roboz.shed.tools.cli_commands import Token

from robozium.api.app import create_app
from robozium.api.projects import Project
from robozium.hub.application import Hub
from robozium.hub.utils import load_hub


@pytest.fixture(autouse=True)
def isolated_hub_config(tmp_path: Path) -> None:
    write_config(tmp_path)


@contextmanager
def command_run(
    tmp_path: Path, tokens: list[Token]
) -> Iterator[tuple[Hub, TestClient, str]]:
    endpoint = MockLLMEndpoint(
        [
            {
                "action": "run_file_command",
                "rationale": "test guarded CLI",
                "value": tokens,
            },
            {"action": "stop", "rationale": "finished", "value": "done"},
        ]
    )

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del endpoint_getter
        agents = configured_deployment(
            Project(sandbox, project_slug), endpoint, event_sinks=event_sinks
        )
        return BuiltAgents(foreground_agent(agents))

    hub = configured_hub(load_hub(start=tmp_path), deployment=deferred_deployment(factory))
    assert hub.settings.sandbox.resolved_root.is_relative_to(tmp_path.resolve())
    application = create_app(deployment=hub)
    client = TestClient(application)
    try:
        if not hub.project("alpha").root.exists():
            assert client.post("/projects", json={"name": "alpha"}).status_code == 200
        response = client.post("/run/create", json={"project": "alpha"})
        assert response.status_code == 200
        run_id = response.json()["run_id"]
        assert application.state.run_manager.start_run(run_id)
        yield hub, client, run_id
    finally:
        assert application.state.run_manager.shutdown()
        client.close()


def wait_for_status(client: TestClient, run_id: str, *statuses: str):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        response = client.get(f"/run/{run_id}")
        assert response.status_code == 200
        view = response.json()
        assert view["status"] not in {"failed", "cancelled"}, view
        if view["status"] in statuses:
            return view
        time.sleep(0.05)
    raise AssertionError(f"run did not reach {statuses}: {view}")


def test_project_file_writes_transfers_and_pipeline(tmp_path: Path) -> None:
    folder = "projects/alpha/generated"
    content = "TAGGED-CLI-MARKER\nsecond line\n"
    tokens: list[Token] = [
        ("mkdir", "CMD"),
        ("-p", "FLG"),
        (folder, "PTH"),
        ("&&", "CTL"),
        ("tee", "CMD"),
        (content, "ARG"),
        (f"{folder}/source.txt", "PTH"),
        ("&&", "CTL"),
        ("cp", "CMD"),
        (f"{folder}/source.txt", "PTH"),
        (f"{folder}/copy.txt", "PTH"),
        ("&&", "CTL"),
        ("mv", "CMD"),
        (f"{folder}/copy.txt", "PTH"),
        (f"{folder}/result.txt", "PTH"),
        ("&&", "CTL"),
        ("rm", "CMD"),
        (f"{folder}/source.txt", "PTH"),
        ("&&", "CTL"),
        ("cat", "CMD"),
        (f"{folder}/result.txt", "PTH"),
        ("|", "CTL"),
        ("head", "CMD"),
        ("-n", "FLG"),
        ("1", "ARG"),
        ("|", "CTL"),
        ("tee", "CMD"),
        (f"{folder}/first-line.txt", "PTH"),
    ]
    with command_run(tmp_path, tokens) as (hub, client, run_id):
        view = wait_for_status(client, run_id, "completed")
        output = hub.settings.sandbox.resolved_root / folder
        assert (output / "result.txt").read_text() == content
        assert (output / "first-line.txt").read_text() == "TAGGED-CLI-MARKER\n"
        assert not (output / "source.txt").exists()
        assert not (output / "copy.txt").exists()
        assert any(
            "TAGGED-CLI-MARKER" in entry.get("payload", {}).get("content", "")
            for entry in view["message_trace"]
        )


@pytest.mark.parametrize(
    "destination", ["readonly/note.txt", "projects/beta/note.txt", "outside"]
)
def test_file_command_denies_writes_outside_project(
    tmp_path: Path, destination: str
) -> None:
    hub = load_hub(start=tmp_path)
    target = (
        tmp_path / "outside.txt"
        if destination == "outside"
        else hub.settings.sandbox.resolved_root / destination
    )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("keep this file")
    with command_run(
        tmp_path,
        [
            ("tee", "CMD"),
            ("unauthorized replacement", "ARG"),
            (str(target), "PTH"),
        ],
    ) as (_, client, run_id):
        wait_for_status(client, run_id, "completed")
        assert target.read_text() == "keep this file"


@pytest.mark.parametrize("reply", ["yes", "no"])
def test_shared_file_overwrite_requires_http_approval(
    tmp_path: Path, reply: str
) -> None:
    hub = load_hub(start=tmp_path)
    source = hub.project("alpha").root / "source.txt"
    shared = hub.settings.sandbox.shared_dir / "shared.txt"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("replacement")
    shared.parent.mkdir(parents=True, exist_ok=True)
    shared.write_text("original")
    with command_run(
        tmp_path,
        [
            ("cp", "CMD"),
            (str(source), "PTH"),
            (str(shared), "PTH"),
        ],
    ) as (_, client, run_id):
        prompts = set()
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            view = wait_for_status(client, run_id, "awaiting_user_input", "completed")
            if view["status"] == "completed":
                break
            assert shared.read_text() == "original"
            prompt_id = view["current_prompt_id"]
            if prompt_id not in prompts:
                assert str(shared) in view["current_prompt"]
                response = client.post(
                    f"/run/{run_id}/reply",
                    json={"prompt_id": prompt_id, "content": reply},
                )
                assert response.status_code == 200
                prompts.add(prompt_id)
            time.sleep(0.05)
        else:
            raise AssertionError(f"approval flow did not complete: {view}")
        assert prompts
        assert shared.read_text() == ("replacement" if reply == "yes" else "original")
