"""Launch selections travel through the HTTP API into real deployment builds."""

from dataclasses import replace

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


def test_catalogue_uses_deployment_labels(launch_api):
    _, _, client = launch_api
    response = client.get("/capabilities")
    assert response.status_code == 200
    labels = {row["name"]: row for row in response.json()}
    assert labels["filesystem"] == {
        "name": "filesystem",
        "kind": "skill",
        "selectable": False,
        "loading": "automatic",
    }
    assert labels["email"]["selectable"] is True
    assert labels["safe_scripts"]["selectable"] is True
    assert labels["robozium"]["selectable"] is False
    assert labels["compactification"]["selectable"] is False
    assert labels["stop"]["selectable"] is False
    assert labels["optional_tool"] == {
        "name": "optional_tool",
        "kind": "tool",
        "selectable": True,
        "loading": None,
    }
    assert "snapshot_conversations" not in labels


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
    _, manager, client = launch_api
    response = client.post(
        "/run/create", json={"project": "alpha", "capabilities": selection}
    )
    assert response.status_code == 422
    assert manager.list_project_runs() == []


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
        "/run/create", json={"project": "alpha", "capabilities": {"optional_tool": True}}
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
    import json
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
        assert (
            "optional_stop" in json.dumps(requests[0]["messages"])
        ) is enabled
    finally:
        app.state.run_manager.shutdown()
