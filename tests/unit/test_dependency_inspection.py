from __future__ import annotations

import threading
import time
from dataclasses import dataclass, replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from config_support import write_config
from deployment_support import BuiltAgents
from fastapi.testclient import TestClient
from roboz import Agent
from roboz.dependencies import (
    ExecutableDependency,
    ExternalDependency,
    ExternalDependencyKind,
)
from roboz.endpoints.inventory import openrouter
from roboz.models import AgentMode, Empty, Message
from roboz.tooling.decorators import factory

from robozium.api.app import create_app, mock_app
from robozium.hub.utils import load_hub

_TEST_ORCHESTRATOR_ENDPOINT = openrouter.z_ai__glm_5_3


@dataclass(frozen=True)
class ResourceContext:
    resources: tuple[ExternalDependency, ...]

    def external_dependencies(self):
        return self.resources


@factory
def dependency_tool(
    input: Empty, messages: list[Message], ctx: ResourceContext
) -> Empty:
    return input


def _factory_for(*resources):
    def build(sandbox, project_slug, /, *, endpoint_getter, event_sinks):
        bound = dependency_tool(ResourceContext(tuple(resources)))
        return BuiltAgents(
            Agent(
                name="dependency_test",
                event_sinks=event_sinks,
                mode=AgentMode.DETERMINISTIC,
                agent_endpoint=None,
                default_tools=[bound],
            )
        )

    return build


def _offline_models(config, checked):
    def endpoint(value):
        def list_models(**kwargs):
            checked.add(value.dependency_id)
            return SimpleNamespace(data=[SimpleNamespace(id=value.model_name)])

        def forbidden(**kwargs):
            pytest.fail("Health observation must not generate completions")

        client = SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=forbidden)),
            models=SimpleNamespace(list=list_models),
            close=forbidden,
        )
        return value.model_copy(update={"client": client})

    return {key: endpoint(value) for key, value in config.models.items()}


def _deployment_with_check(root, name, check):
    class CheckedExecutable(ExecutableDependency):
        def check(self):
            return check(self)

    hub = load_hub(start=root)
    models = _offline_models(hub, set())
    return replace(
        hub,
        models=models,
        default_model=next(iter(models.values())),
        deployment=_factory_for(CheckedExecutable(name)),
        transcription_endpoint=None,
    )


def _inspect(hub, slug):
    agent, _ = hub.configure_deployment(
        hub.project(slug).sandbox,
        slug,
        endpoint_getter=lambda: hub.model_selector.selected_endpoint,
        event_sinks=(),
    )
    from roboz.dependencies import dedupe_external_dependencies

    return dedupe_external_dependencies(
        (
            *agent.external_dependencies(),
            *hub.models.values(),
            *(hub.additional_dependencies or ()),
        )
    )


def test_standard_deployment_discovers_tools_and_every_selectable_model() -> None:
    deployment = load_hub()
    project = deployment.project("inspection")
    discovered = _inspect(deployment, project.slug)
    assert any(item.kind == ExternalDependencyKind.EXECUTABLE for item in discovered)
    assert {
        item.dependency_id
        for item in discovered
        if item.kind == ExternalDependencyKind.MODEL_ENDPOINT
    } == {
        endpoint.dependency_id
        for endpoint in (
            *deployment.models.values(),
            deployment.configure_deployment(
                project.sandbox,
                project.slug,
                endpoint_getter=lambda: deployment.model_selector.selected_endpoint,
            )[1][0].agent_endpoint,
        )
    }


def test_mock_app_dependency_contract_allows_startup() -> None:
    with TestClient(mock_app()) as client:
        assert client.get("/ready").status_code == 200
        assert client.get("/models").json() == {
            "models": [{"model_id": "model:mock:mock", "label": "Mock"}],
            "selected_model_id": "model:mock:mock",
        }


def test_endpoint_catalog_drives_models_and_health_without_completions(tmp_path):
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    config = load_hub(start=tmp_path)
    checked = set()
    endpoints = _offline_models(config, checked)
    expected = {endpoint.dependency_id for endpoint in endpoints.values()}
    hub = replace(
        config,
        models=endpoints,
        default_model=next(iter(endpoints.values())),
        deployment=_factory_for(),
        transcription_endpoint=None,
    )
    assert checked == set()
    endpoints.clear()
    assert hub.model_selector.selected_endpoint is hub.default_model
    with pytest.raises(TypeError):
        hub.models["replacement"] = hub.model_selector.selected_endpoint  # type: ignore[index]
    with TestClient(create_app(deployment=hub)) as client:
        models = client.get("/models").json()["models"]
        assert {model["model_id"] for model in models} == expected
        selected = models[1]["model_id"]
        assert (
            client.post("/models", json={"model_id": selected}).json()[
                "selected_model_id"
            ]
            == selected
        )
        assert hub.model_selector.selected_endpoint is tuple(hub.models.values())[1]
        records = client.post("/admin/dependencies/check").json()
        assert {record["dependency_id"] for record in records} == expected
        assert checked == expected


def test_inspection_builds_in_the_configured_scope_without_starting_agents(tmp_path):
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    hub = load_hub(start=tmp_path)
    observed = []

    def build(sandbox, slug, /, **kwargs):
        observed.append((sandbox.root, sandbox.scope, slug))
        return _factory_for(ExecutableDependency("bash"))(sandbox, slug, **kwargs)

    hub = replace(hub, deployment=build)
    slug = hub.project(hub.name).slug
    assert any(r.dependency_id == "executable:bash" for r in _inspect(hub, slug))
    assert observed == [(hub.sandbox.root, slug, slug)]
    assert not (tmp_path / "sandbox").exists()


def test_api_reads_cached_state_and_dependency_failure_does_not_affect_ready(
    tmp_path: Path,
) -> None:
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    calls = 0

    def checker(dependency):
        nonlocal calls
        del dependency
        calls += 1
        return False

    application = create_app(
        deployment=_deployment_with_check(tmp_path, "missing", checker),
    )
    with TestClient(application) as client:
        deadline = time.monotonic() + 2
        record = client.get("/admin/dependencies").json()[0]
        while record["status"] == "pending":
            assert time.monotonic() < deadline
            time.sleep(0.01)
            record = client.get("/admin/dependencies").json()[0]
        initial_calls = calls
        checked_at = record["checked_at"]
        for _ in range(3):
            assert client.get("/admin/dependencies").status_code == 200
            detail = client.get("/admin/dependencies/executable:missing")
            assert detail.status_code == 200
            assert detail.json()["checked_at"] == checked_at
        assert calls == initial_calls
        assert record["status"] == "unavailable"
        assert client.get("/ready").status_code == 200
        assert client.get("/live").status_code == 200
        assert client.get("/admin/dependencies/executable:unknown").status_code == 404


def test_api_active_check_runs_checkers_and_returns_updated_cached_records(
    tmp_path: Path,
) -> None:
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    calls = 0

    def checker(dependency):
        nonlocal calls
        del dependency
        calls += 1
        return True if calls == 1 else False

    application = create_app(
        deployment=_deployment_with_check(tmp_path, "sometimes", checker),
    )
    with TestClient(application) as client:
        deadline = time.monotonic() + 2
        cached = client.get("/admin/dependencies").json()[0]
        while cached["status"] == "pending":
            assert time.monotonic() < deadline
            time.sleep(0.01)
            cached = client.get("/admin/dependencies").json()[0]

        response = client.post("/admin/dependencies/check")

        assert response.status_code == 200
        assert response.json()[0]["status"] == "unavailable"
        assert response.json()[0]["reason_code"] == "not_found"
        assert response.json()[0]["checked_at"] != cached["checked_at"]
        assert calls == 2
        assert client.get("/admin/dependencies").json() == response.json()
        assert client.get("/ready").status_code == 200


def test_api_active_check_preserves_no_overlap_behavior(tmp_path: Path) -> None:
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    calls = 0
    entered = threading.Event()
    release = threading.Event()

    def checker(dependency):
        nonlocal calls
        del dependency
        calls += 1
        entered.set()
        release.wait(timeout=5)
        return True

    application = create_app(
        deployment=_deployment_with_check(tmp_path, "slow", checker),
    )
    with TestClient(application) as client:
        assert entered.wait(timeout=2)
        response = client.post("/admin/dependencies/check")

        assert response.status_code == 200
        assert calls == 1
        release.set()


def test_standalone_resource_is_monitored_without_an_agent_tool(tmp_path):
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )

    class Standalone(ExecutableDependency):
        def check(self):
            return True

    hub = _deployment_with_check(tmp_path, "tool", lambda _: True)
    standalone = Standalone("standalone")
    hub = replace(hub, additional_dependencies=(standalone, standalone))
    with TestClient(create_app(deployment=hub)) as client:
        records = client.post("/admin/dependencies/check").json()
        found = [r for r in records if r["dependency_id"] == standalone.dependency_id]
        assert len(found) == 1
        assert found[0]["status"] == "available"


@pytest.mark.parametrize("setting", ["interval_s", "timeout_s"])
def test_hub_health_settings_control_runtime_checks(tmp_path, setting):
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    calls = 0

    def checker(dependency):
        nonlocal calls
        calls += 1
        if setting == "timeout_s":
            time.sleep(0.15)
        return True

    hub = _deployment_with_check(tmp_path, "configured", checker)
    hub = replace(
        hub, dependency_health=replace(hub.dependency_health, **{setting: 0.02})
    )
    with TestClient(create_app(deployment=hub)) as client:
        deadline = time.monotonic() + 2
        while True:
            record = client.get("/admin/dependencies/executable:configured").json()
            if setting == "timeout_s" and record["reason_code"] == "timeout":
                break
            if setting == "interval_s" and calls >= 2:
                break
            assert time.monotonic() < deadline, record
            time.sleep(0.01)
        assert client.get("/ready").status_code == 200
