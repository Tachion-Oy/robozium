from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import replace
from pathlib import Path

import pytest
from config_support import write_config
from deployment_support import BuiltAgents
from fastapi.testclient import TestClient
from roboshed.dependency_health import (
    DependencyCheckResult,
    DependencyReasonCode,
    check_executable,
    inspect_dependencies,
)
from roboz import Agent
from roboz.dependencies import (
    DependencyContractError,
    DependencyRegistration,
    ExecutableDependency,
    ExternalDependencyKind,
)
from roboz.llm import MockTranscriptionEndpoint
from roboz.models import Empty, Message
from roboz.tooling import Ctx
from roboz.tooling.decorators import factory
from roboz_endpoints import openrouter

from robosprawl.api.app import create_app, mock_app
from robosprawl.hub.utils import load_hub

_TEST_ORCHESTRATOR_ENDPOINT = openrouter.z_ai__glm_5_3


@factory
def dependency_tool(input: Empty, messages: list[Message], ctx: Ctx) -> Empty:
    del messages, ctx
    return input


def _factory_for(*names: str):
    def build(sandbox, project_slug, /, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter
        bound = dependency_tool(
            Ctx(dependencies=tuple(ExecutableDependency(name) for name in names))
        )
        return BuiltAgents(
            agent=Agent(
                name="dependency_test",
                event_sinks=event_sinks,
                is_agentic=False,
                agent_endpoint=None,
                default_tools=[bound],
            ),
            background_agents=(),
        )

    return build


def _registration(
    name: str,
    *,
    kind: ExternalDependencyKind = ExternalDependencyKind.EXECUTABLE,
    check=check_executable,
) -> DependencyRegistration:
    return DependencyRegistration(f"executable:{name}", kind, check)


def _deployment_with_check(root, name, check):
    hub = replace(
        load_hub(start=root), deployment=_factory_for(name), transcription_endpoint=None
    )
    return replace(
        hub,
        dependency_registry=(
            _registration(name, check=check),
            *(
                DependencyRegistration(
                    endpoint.dependency_id,
                    endpoint.kind,
                    lambda _: DependencyCheckResult.success(),
                )
                for endpoint in hub.model_selector.models.values()
            ),
        ),
    )


def test_standard_deployment_discovers_tools_and_every_selectable_model() -> None:
    deployment = load_hub()
    project = deployment.project("inspection")
    discovered = inspect_dependencies(
        lambda sandbox: deployment.configure_deployment(
            sandbox,
            project.slug,
            endpoint_getter=lambda: deployment.model_selector.selected_endpoint,
            event_sinks=(),
        ),
        sandbox=deployment.sandbox,
        registrations=deployment.dependency_registry,
        additional_dependencies=tuple(deployment.model_selector.models.values()),
    )
    assert any(
        item.dependency.kind == ExternalDependencyKind.EXECUTABLE for item in discovered
    )
    assert {
        item.dependency.dependency_id
        for item in discovered
        if item.dependency.kind == ExternalDependencyKind.MODEL_ENDPOINT
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


def test_endpoint_catalog_drives_models_and_health_without_materialization(tmp_path):
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    config = load_hub(start=tmp_path)
    endpoints = {
        key: replace(value, resolver=lambda: pytest.fail("materialized"))
        for key, value in config.models.items()
    }
    expected = {endpoint.dependency_id for endpoint in endpoints.values()}
    checked = set()

    def checker(endpoint):
        checked.add(endpoint.dependency_id)
        return DependencyCheckResult.success()

    hub = replace(
        config,
        models=endpoints,
        default_model=next(
            endpoint
            for endpoint in endpoints.values()
            if endpoint.dependency_id == config.default_model.dependency_id
        ),
        deployment=_factory_for(),
        transcription_endpoint=None,
        dependency_registry=tuple(
            DependencyRegistration(endpoint.dependency_id, endpoint.kind, checker)
            for endpoint in endpoints.values()
        ),
    )
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


def test_inspection_uses_a_temporary_project_not_the_configured_sandbox(
    tmp_path: Path,
) -> None:
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    configured_sandbox = tmp_path / "sandbox"
    hub_config = load_hub(start=tmp_path)
    slug = hub_config.project(hub_config.name).slug
    inspect_dependencies(
        lambda sandbox: _factory_for("bash")(
            sandbox.for_project(slug),
            slug,
            endpoint_getter=lambda: _TEST_ORCHESTRATOR_ENDPOINT,
            event_sinks=(),
        ),
        sandbox=hub_config.sandbox,
        registrations=[_registration("bash")],
    )
    assert not configured_sandbox.exists()


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
        return DependencyCheckResult.failure(DependencyReasonCode.NOT_FOUND)

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
        return (
            DependencyCheckResult.success()
            if calls == 1
            else DependencyCheckResult.failure(DependencyReasonCode.NOT_FOUND)
        )

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
        return DependencyCheckResult.success()

    application = create_app(
        deployment=_deployment_with_check(tmp_path, "slow", checker),
    )
    with TestClient(application) as client:
        assert entered.wait(timeout=2)
        response = client.post("/admin/dependencies/check")

        assert response.status_code == 200
        assert calls == 1
        release.set()


def test_registry_mismatch_fails_testclient_lifespan(tmp_path: Path) -> None:
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    application = create_app(
        deployment=replace(
            load_hub(start=tmp_path),
            deployment=_factory_for("unregistered"),
            transcription_endpoint=MockTranscriptionEndpoint(["unused"]),
            dependency_registry=(),
        ),
    )
    with pytest.raises(DependencyContractError, match="executable:unregistered"):
        with TestClient(application):
            pass


@pytest.mark.parametrize("setting", ["interval_s", "timeout_s"])
def test_hub_health_settings_control_runtime_checks(tmp_path, setting):
    write_config(
        tmp_path, sandbox_root="sandbox", name="DependencyTestHub", interval_s=3600
    )
    calls = 0

    async def checker(dependency):
        nonlocal calls
        calls += 1
        if setting == "timeout_s":
            await asyncio.Event().wait()
        return DependencyCheckResult.success()

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
