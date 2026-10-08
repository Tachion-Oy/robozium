"""Capability discovery, saved choices, and run selection have separate contracts."""

import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from threading import Event

import pytest
from config_support import write_config
from fastapi.testclient import TestClient
from roboz.deployment import Capability, ToolLabel
from roboz.tools import stop

from robozium.api.app import create_app
from robozium.hub.utils import load_hub


@pytest.fixture
def launch_api(tmp_path):
    hub = load_hub(config_file=write_config(tmp_path))
    hub = replace(
        hub,
        additional_capabilities=(
            *hub.additional_capabilities,
            Capability(
                label=ToolLabel("optional_tool", selectable=True),
                value=stop.copy(name="optional_stop"),
            ),
        ),
    )
    app = create_app(deployment=hub)
    client = TestClient(app)
    assert client.post("/projects", json={"name": "alpha"}).status_code == 200
    yield hub, app.state.run_manager, client
    app.state.run_manager.shutdown()


def catalogue(client):
    response = client.get("/capabilities")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    return {row["name"]: row for row in response.json()}


def saved_file(hub, data):
    path = hub.project("alpha").capabilities_file
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(data, encoding="utf-8")
    return path


def test_catalogue_uses_only_deployment_labels(launch_api):
    hub, _, client = launch_api
    labels = catalogue(client)
    assert labels["filesystem"] == {
        "name": "filesystem",
        "kind": "skill",
        "selectable": False,
        "loading": "automatic",
    }
    assert labels["optional_tool"] == {
        "name": "optional_tool",
        "kind": "tool",
        "selectable": True,
        "loading": None,
    }
    assert "snapshot_conversations" not in labels
    saved_file(hub, "{broken")
    assert catalogue(client) == labels


def test_save_and_read_are_independent_of_runs_and_other_projects(launch_api):
    hub, manager, client = launch_api
    assert client.post("/projects", json={"name": "beta"}).status_code == 200
    assert client.get("/capabilities/alpha").json() is None
    choices = {"email": "on_demand", "optional_tool": True, "removed": False}
    for response in (
        client.post("/capabilities/alpha", json=choices),
        client.get("/capabilities/alpha"),
    ):
        assert response.status_code == 200
        assert response.headers["cache-control"] == "no-store"
        assert response.json() == choices
    path = hub.project("alpha").capabilities_file
    assert json.loads(path.read_text()) == choices
    assert client.get("/capabilities/beta").json() is None
    assert manager.list_project_runs() == []
    assert client.post("/capabilities/alpha", json={}).json() == {}
    assert client.get("/capabilities/alpha").json() == {}
    assert client.delete("/projects/alpha").status_code == 200
    assert not path.exists()


@pytest.mark.parametrize("slug, status", [("unknown", 404), ("%20", 400)])
def test_settings_require_an_existing_valid_project(launch_api, slug, status):
    _, _, client = launch_api
    assert client.get(f"/capabilities/{slug}").status_code == status
    assert client.post(f"/capabilities/{slug}", json={}).status_code == status
    assert [row["slug"] for row in client.get("/projects").json()] == ["alpha"]


def test_saved_choices_survive_restart_and_catalogue_changes_unchanged(launch_api):
    hub, manager, client = launch_api
    choices = {"email": "on_demand", "optional_tool": True}
    assert client.post("/capabilities/alpha", json=choices).status_code == 200
    path = hub.project("alpha").capabilities_file
    original, modified = path.read_bytes(), path.stat().st_mtime_ns
    manager.shutdown()
    updated = replace(
        hub,
        additional_capabilities=(
            Capability(
                label=ToolLabel("new_tool", selectable=True),
                value=stop.copy(name="new_stop"),
            ),
        ),
    )
    app = create_app(deployment=updated)
    try:
        app.state.projects.recover()
        fresh = TestClient(app)
        assert fresh.get("/capabilities/alpha").json() == choices
        labels = catalogue(fresh)
        assert "new_tool" in labels
        assert "optional_tool" not in labels
        assert path.read_bytes() == original
        assert path.stat().st_mtime_ns == modified
    finally:
        app.state.run_manager.shutdown()


@pytest.mark.parametrize(
    "selection", [None, [], {"email": 1}, {"email": "true"}, {"email": "invalid"}]
)
def test_invalid_save_preserves_previous_choices(launch_api, selection):
    hub, _, client = launch_api
    path = saved_file(hub, '{"email": "on_demand"}')
    original = path.read_bytes()
    response = client.post("/capabilities/alpha", json=selection)
    assert response.status_code == 422
    assert path.read_bytes() == original


def test_atomic_save_failure_preserves_previous_choices(launch_api, monkeypatch):
    hub, manager, client = launch_api
    path = saved_file(hub, '{"email": "on_demand"}')
    original = path.read_bytes()
    replace_file = os.replace

    def reject_replace(source, target):
        if Path(target) == path:
            raise PermissionError("read-only destination")
        return replace_file(source, target)

    monkeypatch.setattr(os, "replace", reject_replace)
    response = client.post("/capabilities/alpha", json={})
    assert response.status_code == 500
    assert response.json() == {"detail": "Could not save project capabilities"}
    assert path.read_bytes() == original
    assert not list(path.parent.glob("*.tmp"))
    assert manager.list_project_runs() == []


@pytest.mark.parametrize(
    "data", ["{broken", "[]", '{"email": "invalid"}', '{"email": 1}']
)
def test_invalid_saved_file_explains_recovery_and_can_be_replaced(launch_api, data):
    hub, _, client = launch_api
    path = saved_file(hub, data)
    response = client.get("/capabilities/alpha")
    assert response.status_code == 500
    assert "Repair or remove .robozium/capabilities.json" in response.json()["detail"]
    assert path.read_text() == data
    assert client.post("/capabilities/alpha", json={}).status_code == 200
    assert client.get("/capabilities/alpha").json() == {}


@pytest.mark.parametrize("selection", [None, {}, {"email": "on_demand"}])
def test_run_creation_does_not_read_or_write_saved_choices(launch_api, selection):
    hub, _, client = launch_api
    path = saved_file(hub, "{broken")
    original, modified = path.read_bytes(), path.stat().st_mtime_ns
    response = client.post(
        "/run/create", json={"project": "alpha", "capabilities": selection}
    )
    assert response.status_code == 200
    effective = client.get(f"/run/{response.json()['run_id']}").json()["capabilities"]
    assert effective["email"] == (
        "automatic" if selection is None else selection.get("email", False)
    )
    assert path.read_bytes() == original
    assert path.stat().st_mtime_ns == modified


def test_saving_choices_does_not_change_an_active_run(launch_api):
    _, _, client = launch_api
    run = client.post(
        "/run/create", json={"project": "alpha", "capabilities": {}}
    ).json()["run_id"]
    choices = {"email": "on_demand"}
    assert client.post("/capabilities/alpha", json=choices).status_code == 200
    assert client.get(f"/run/{run}").json()["capabilities"]["email"] is False
    assert client.get("/capabilities/alpha").json() == choices


@pytest.mark.parametrize("symlink", [False, True])
def test_saving_leaves_existing_user_capabilities_artifact_untouched(
    launch_api, symlink
):
    hub, _, client = launch_api
    root = hub.project("alpha").root
    artifact = root / "capabilities.json"
    if symlink:
        report = root / "report.txt"
        report.write_text("User document", encoding="utf-8")
        artifact.symlink_to(report.name)
    else:
        artifact.write_text('{"generated_report": {"tools": []}}', encoding="utf-8")
    original = artifact.read_bytes()
    assert client.get("/capabilities/alpha").json() is None
    assert client.post("/capabilities/alpha", json={"email": True}).status_code == 200
    assert artifact.read_bytes() == original


@pytest.mark.parametrize("redirect", ["file", "directory"])
def test_metadata_symlinks_are_rejected_without_overwriting_targets(
    launch_api, redirect
):
    hub, _, client = launch_api
    project = hub.project("alpha")
    target = project.root / "user-data"
    target.mkdir()
    report = target / "capabilities.json"
    report.write_text('{"email": true}', encoding="utf-8")
    path = project.capabilities_file
    if redirect == "file":
        path.parent.mkdir()
        path.symlink_to(report)
    else:
        path.parent.symlink_to(target, target_is_directory=True)
    assert client.get("/capabilities/alpha").status_code == 500
    assert client.post("/capabilities/alpha", json={}).status_code == 500
    assert report.read_text() == '{"email": true}'


def test_saving_cannot_recreate_a_project_being_deleted(launch_api, monkeypatch):
    hub, _, client = launch_api
    entered, release, attempted, returned = Event(), Event(), Event(), Event()
    remove = shutil.rmtree

    def blocking_remove(path):
        entered.set()
        assert release.wait(3)
        remove(path)

    def save():
        attempted.set()
        try:
            return client.post("/capabilities/alpha", json={"email": True})
        finally:
            returned.set()

    monkeypatch.setattr(shutil, "rmtree", blocking_remove)
    with ThreadPoolExecutor(max_workers=2) as pool:
        deletion = pool.submit(client.delete, "/projects/alpha")
        try:
            assert entered.wait(3)
            saving = pool.submit(save)
            assert attempted.wait(3)
            assert not returned.wait(0.05)
        finally:
            release.set()
        assert deletion.result(timeout=3).status_code == 200
        assert saving.result(timeout=3).status_code == 404
    assert not hub.project("alpha").root.exists()


def test_duplicate_project_creation_preserves_saved_choices(launch_api):
    hub, _, client = launch_api
    path = saved_file(hub, '{"email": true}')
    assert client.post("/projects", json={"name": "Alpha"}).status_code == 409
    assert path.read_text() == '{"email": true}'


@pytest.mark.parametrize(
    "selection",
    [
        {"missing": True},
        {"stop": False},
        {"filesystem": False},
        {"email": "invalid"},
        {"email": 1},
        {"email": "true"},
        {"optional_tool": "on_demand"},
    ],
)
def test_invalid_selection_does_not_register_a_run(launch_api, selection):
    hub, manager, client = launch_api
    response = client.post(
        "/run/create", json={"project": "alpha", "capabilities": selection}
    )
    assert response.status_code == 422
    assert manager.list_project_runs() == []
    assert not hub.project("alpha").capabilities_file.exists()


@pytest.mark.parametrize(
    "selection, email, optional",
    [
        (None, "automatic", True),
        ({}, False, False),
        ({"email": True}, "automatic", False),
        ({"email": "on_demand", "optional_tool": True}, "on_demand", True),
    ],
)
def test_effective_selection_controls_the_build(launch_api, selection, email, optional):
    hub, manager, client = launch_api
    body = {"project": "alpha"}
    if selection is not None:
        body["capabilities"] = selection
    response = client.post("/run/create", json=body)
    assert response.status_code == 200
    run_id = response.json()["run_id"]
    choices = client.get(f"/run/{run_id}").json()["capabilities"]
    assert choices["email"] == email
    assert choices["optional_tool"] is optional
    assert manager.get_run(run_id)["worker_alive"] is False
    project = hub.project("alpha")
    # Use the validated enum values held by the run, not raw HTTP strings.
    definition = hub.configure_deployment(
        project.sandbox,
        project.slug,
        endpoint_getter=lambda: hub.default_model,
    )
    definition.set_capability_selection(manager.get_run(run_id)["capabilities"])
    root, (maintenance,) = definition.build()
    assert any(skill.name == "filesystem" for skill in root.auto_loaded_skills)
    assert ("optional_stop" in {tool.name for tool in root.tools}) is optional
    assert any(skill.name == "email_tools" for skill in root.auto_loaded_skills) is (
        email == "automatic"
    )
    assert any(skill.name == "email_tools" for skill in root.skills) is (
        email == "on_demand"
    )
    assert maintenance.name == "librarian"
    assert maintenance.default_tools[0].name == "snapshot_conversations"


def test_reuse_compares_effective_choices_and_projects_are_independent(launch_api):
    _, _, client = launch_api
    first = client.post(
        "/run/create", json={"project": "alpha", "capabilities": {"email": True}}
    )
    assert first.status_code == 200
    for body in (
        {"project": "alpha"},
        {"project": "alpha", "capabilities": {"email": "automatic"}},
    ):
        assert client.post("/run/create", json=body).json() == first.json()
    assert (
        client.post(
            "/run/create", json={"project": "alpha", "capabilities": {}}
        ).status_code
        == 409
    )
    assert client.post("/projects", json={"name": "beta"}).status_code == 200
    second = client.post(
        "/run/create", json={"project": "beta", "capabilities": {}}
    ).json()["run_id"]
    assert client.get(f"/run/{second}").json()["capabilities"]["email"] is False
    assert (
        client.get(f"/run/{first.json()['run_id']}").json()["capabilities"]["email"]
        == "automatic"
    )


def test_relaunch_replaces_choices_and_preserves_project_memory(launch_api):
    hub, _, client = launch_api
    project = hub.project("alpha")
    project.memory.mkdir(parents=True)
    memory = project.memory / "memory.md"
    memory.write_text("Remember the user's project preferences.")
    first = client.post(
        "/run/create", json={"project": "alpha", "capabilities": {"email": True}}
    ).json()["run_id"]
    assert client.post("/projects/alpha/cancel").status_code == 200
    second = client.post(
        "/run/create",
        json={"project": "alpha", "capabilities": {"optional_tool": True}},
    ).json()["run_id"]
    assert second != first
    choices = client.get(f"/run/{second}").json()["capabilities"]
    assert choices["email"] is False
    assert choices["optional_tool"] is True
    assert client.get(f"/run/{first}").json()["capabilities"]["email"] == "automatic"
    assert memory.read_text() == "Remember the user's project preferences."
    assert list(project.memory.iterdir()) == [memory]


@pytest.mark.parametrize("enabled", [False, True])
def test_worker_builds_with_the_creation_selection(launch_api, enabled):
    from types import SimpleNamespace

    from roboz.llm import LLMEndpoint, MockLLMEndpoint

    hub, _, _ = launch_api
    requests = []

    def complete(**request):
        requests.append(request)
        return SimpleNamespace(
            usage=None,
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=json.dumps(
                            {
                                "action": "stop",
                                "rationale": "done",
                                "value": "finished",
                            }
                        )
                    ),
                )
            ],
        )

    endpoint = LLMEndpoint(
        client=SimpleNamespace(
            models=object(),
            close=lambda: None,
            chat=SimpleNamespace(completions=SimpleNamespace(create=complete)),
        ),
        api_name="test",
        model_name="selection",
        stream=False,
    )
    hub = replace(
        hub,
        models={"Test": endpoint},
        default_model=endpoint,
        memory_endpoint=MockLLMEndpoint([]),
    )
    app = create_app(deployment=hub)
    client = TestClient(app)
    try:
        run_id = client.post(
            "/run/create",
            json={
                "project": "alpha",
                "capabilities": {"optional_tool": enabled},
            },
        ).json()["run_id"]
        assert client.get(f"/run/{run_id}/stream").status_code == 200
        assert client.get(f"/run/{run_id}").json()["status"] == "completed"
        assert ("optional_stop" in json.dumps(requests[0]["messages"])) is enabled
    finally:
        app.state.run_manager.shutdown()
