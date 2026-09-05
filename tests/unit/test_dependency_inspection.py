from __future__ import annotations

import asyncio
import json
import ssl
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from roboz import Agent, FactoryCtx
from roboz.llm import LLMEndpoint, MockTranscriptionEndpoint
from roboz.models import Empty, Message
from roboz.tooling import (
    ExecutableDependency,
    ExternalDependencyKind,
    LazyExternalDependency,
    NetworkServiceDependency,
    ToolDependency,
)
from roboz.tooling.decorators import factory

from robosprawl.api.app import create_app, mock_app
from robosprawl.api.dependencies import inspect_dependencies
from robosprawl.composition import RootAgentBundle
from robosprawl.dependency_contract import (
    DependencyContractError,
    DependencyRegistration,
    bind_dependencies,
)
from robosprawl.dependency_health import (
    DependencyCheckResult,
    DependencyHealthMonitor,
    DependencyReasonCode,
    DependencyStatus,
    check_executable,
    check_network_service,
    check_openai_compatible_endpoint,
    reason_code_for_exception,
)
from robosprawl.deployment import (
    ORCHESTRATOR_MODELS,
    STANDARD_DEPENDENCY_REGISTRY,
    HubDeployment,
    standard_orchestrator_factory,
)
from robosprawl.hub import load_hub_config, transcription_endpoint

_TEST_ORCHESTRATOR_ENDPOINT = next(iter(ORCHESTRATOR_MODELS.values()))


@dataclass(frozen=True)
class _DependenciesCtx(FactoryCtx):
    dependencies: tuple[ToolDependency[ExecutableDependency], ...]


@factory
def dependency_tool(
    input: Empty, messages: list[Message], ctx: _DependenciesCtx
) -> Empty:
    del messages, ctx
    return input


def _factory_for(*names: str):
    def build(project, /, *, endpoint_getter, event_sinks):
        del project, endpoint_getter
        bound = dependency_tool(
            _DependenciesCtx(
                tuple(ToolDependency(ExecutableDependency(name)) for name in names)
            )
        )
        return RootAgentBundle(
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


def _write_config(root: Path) -> None:
    (root / "hub.config.json").write_text(
        json.dumps(
            {
                "hub": {"name": "DependencyTestHub"},
                "logging": {
                    "console": {"level": "INFO"},
                    "file": {
                        "path": "technical_logs/backend.jsonl",
                        "level": "DEBUG",
                        "max_bytes": 26214400,
                        "backup_count": 5,
                        "on_error": "fail",
                    },
                },
                "sandbox": {
                    "root": "sandbox",
                    "readonly": "readonly",
                    "workspace": "workspace",
                    "projects": "projects",
                    "safe_scripts": "safe-scripts",
                },
                "project": {
                    "logs": "conversation_logs",
                    "snapshots": "conversation_snapshots",
                    "memory": "persistent_memory",
                },
            }
        ),
        encoding="utf-8",
    )


def test_registry_requires_exact_discovery_equality() -> None:
    discovered = [ExecutableDependency("bash")]
    bound = bind_dependencies(discovered, [_registration("bash")])
    assert tuple(item.dependency for item in bound) == tuple(discovered)

    with pytest.raises(DependencyContractError, match="contract mismatch.*missing"):
        bind_dependencies(
            [*discovered, ExecutableDependency("missing")], [_registration("bash")]
        )
    with pytest.raises(DependencyContractError, match="contract mismatch.*stale"):
        bind_dependencies(discovered, [_registration("bash"), _registration("stale")])


def test_registry_rejects_kind_and_duplicate_errors() -> None:
    discovered = [ExecutableDependency("bash")]
    with pytest.raises(DependencyContractError, match="contract mismatch"):
        bind_dependencies(
            discovered,
            [_registration("bash", kind=ExternalDependencyKind.NETWORK_SERVICE)],
        )
    with pytest.raises(DependencyContractError, match="duplicate dependency"):
        bind_dependencies(discovered, [_registration("bash"), _registration("bash")])


def test_registry_validation_happens_before_any_checker_runs() -> None:
    calls: list[str] = []

    def checker(dependency):
        calls.append(dependency.dependency_id)
        return DependencyCheckResult.success()

    with pytest.raises(DependencyContractError):
        bind_dependencies(
            [ExecutableDependency("bash"), ExecutableDependency("extra")],
            [_registration("bash", check=checker)],
        )
    assert calls == []


def test_arbitrary_endpoint_ids_each_require_their_own_registration() -> None:
    first, _ = _lazy_endpoint(model="one")
    second, _ = _lazy_endpoint(model="two")
    registrations = [
        DependencyRegistration(
            first.dependency_id,
            ExternalDependencyKind.MODEL_ENDPOINT,
            check_openai_compatible_endpoint,
        )
    ]
    with pytest.raises(DependencyContractError, match="model:provider:two"):
        bind_dependencies([first, second], registrations)


def test_standard_deployment_discovery_exactly_matches_explicit_registry() -> None:
    assert transcription_endpoint() is None
    hub_config = load_hub_config()
    bound = inspect_dependencies(
        standard_orchestrator_factory,
        project=hub_config.project(hub_config.name),
        endpoint_getter=lambda: _TEST_ORCHESTRATOR_ENDPOINT,
        registrations=STANDARD_DEPENDENCY_REGISTRY,
        hub_dependencies=tuple(ORCHESTRATOR_MODELS.values()),
    )
    assert {item.dependency.dependency_id for item in bound} == {
        item.dependency_id for item in STANDARD_DEPENDENCY_REGISTRY
    }
    assert all(item.dependency.kind in {ExternalDependencyKind.EXECUTABLE, ExternalDependencyKind.MODEL_ENDPOINT} for item in bound)


def test_mock_app_dependency_contract_allows_startup() -> None:
    with TestClient(mock_app) as client:
        assert client.get("/ready").status_code == 200


def test_inspection_uses_a_temporary_project_not_the_configured_sandbox(
    tmp_path: Path,
) -> None:
    _write_config(tmp_path)
    configured_sandbox = tmp_path / "sandbox"
    hub_config = load_hub_config(start=tmp_path)
    inspect_dependencies(
        _factory_for("bash"),
        project=hub_config.project(hub_config.name),
        endpoint_getter=lambda: _TEST_ORCHESTRATOR_ENDPOINT,
        registrations=[_registration("bash")],
    )
    assert not configured_sandbox.exists()


def test_executable_checker_found_missing_and_non_executable(tmp_path: Path) -> None:
    assert check_executable(ExecutableDependency(sys.executable)).available
    missing = check_executable(ExecutableDependency("definitely-not-an-executable"))
    assert missing.reason_code is DependencyReasonCode.NOT_FOUND

    target = tmp_path / "not-executable"
    target.write_text("data", encoding="utf-8")
    target.chmod(0o644)
    result = check_executable(ExecutableDependency(str(target)))
    assert result.reason_code is DependencyReasonCode.NOT_FOUND




class _Models:
    def __init__(self, ids: list[str], calls: list[tuple[str, object]]) -> None:
        self.ids = ids
        self.calls = calls

    def list(self, *, timeout: float):
        self.calls.append(("models.list", timeout))
        return SimpleNamespace(data=[SimpleNamespace(id=item) for item in self.ids])


class _ProviderClient:
    def __init__(self, ids: list[str], calls: list[tuple[str, object]]) -> None:
        self.models = _Models(ids, calls)
        self.chat = SimpleNamespace(
            completions=SimpleNamespace(
                create=lambda **kwargs: (_ for _ in ()).throw(
                    AssertionError("completion called")
                )
            )
        )
        self.audio = SimpleNamespace(
            transcriptions=SimpleNamespace(
                create=lambda **kwargs: (_ for _ in ()).throw(
                    AssertionError("transcription called")
                )
            )
        )


def _lazy_endpoint(
    *, model: str = "provider/model", ids: list[str] | None = None, resolver_error=None
):
    calls: list[tuple[str, object]] = []

    def resolve():
        if resolver_error is not None:
            raise resolver_error
        return LLMEndpoint(
            client=_ProviderClient(ids or [model], calls),
            api_name="provider",
            model_name=model,
        )

    return (
        LazyExternalDependency(
            dependency_id_value=f"model:provider:{model}",
            dependency_kind=ExternalDependencyKind.MODEL_ENDPOINT,
            metadata={
                "api_name": "provider",
                "model_name": model,
                "endpoint_type": "llm",
            },
            resolver=resolve,
        ),
        calls,
    )


def test_model_checker_uses_only_discovery_and_recognizes_route_suffix() -> None:
    dependency, calls = _lazy_endpoint(
        model="provider/model:nitro", ids=["provider/model"]
    )
    result = check_openai_compatible_endpoint(dependency)
    assert result.available
    assert calls == [("models.list", 10.0)]


def test_model_checker_maps_materialization_and_missing_model_failures() -> None:
    dependency, _ = _lazy_endpoint(
        resolver_error=ValueError("PROVIDER_API_KEY not found in environment variables")
    )
    assert (
        check_openai_compatible_endpoint(dependency).reason_code
        is DependencyReasonCode.MISSING_CREDENTIALS
    )

    absent, calls = _lazy_endpoint(ids=["other/model"])
    result = check_openai_compatible_endpoint(absent)
    assert result.reason_code is DependencyReasonCode.MODEL_UNAVAILABLE
    assert calls == [("models.list", 10.0)]


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (TimeoutError(), DependencyReasonCode.TIMEOUT),
        (ssl.SSLError(), DependencyReasonCode.TLS_FAILED),
        (ConnectionError(), DependencyReasonCode.CONNECTION_FAILED),
        (TypeError(), DependencyReasonCode.PROTOCOL_ERROR),
    ],
)
def test_stable_exception_reason_mapping(error: Exception, reason) -> None:
    assert reason_code_for_exception(error) is reason


def test_multiple_model_endpoints_are_checked_independently() -> None:
    first, first_calls = _lazy_endpoint(model="one")
    second, second_calls = _lazy_endpoint(model="two")
    assert check_openai_compatible_endpoint(first).available
    assert check_openai_compatible_endpoint(second).available
    assert first_calls == [("models.list", 10.0)]
    assert second_calls == [("models.list", 10.0)]


class _ProbeProvider(NetworkServiceDependency):
    def __init__(self, error: Exception | None = None) -> None:
        self.error = error
        self.probe_calls = 0
        self.create_calls = 0

    @property
    def dependency_id(self) -> str:
        return "network:probe"

    def redacted_metadata(self):
        return {"provider": "probe", "password": "must-not-leak"}

    def probe(self):
        self.probe_calls += 1
        if self.error is not None:
            raise self.error
        return {"drafts_mailbox": "Drafts"}

    def create_draft(self, request, *, is_cancelled):
        del request, is_cancelled
        self.create_calls += 1
        raise AssertionError("mailbox mutation attempted")

    def search_messages(self, request, *, is_cancelled):
        raise AssertionError("mailbox search attempted")

    def read_message(self, mailbox, source_message_ref, *, is_cancelled):
        raise AssertionError("message read attempted")

    def download_attachment(self, attachment_ref, *, is_cancelled):
        raise AssertionError("attachment download attempted")

    def create_reply_draft(self, request, *, is_cancelled):
        raise AssertionError("reply draft creation attempted")


def test_network_checker_uses_only_the_service_owned_read_only_probe() -> None:
    provider = _ProbeProvider()
    assert check_network_service(provider).available
    assert provider.probe_calls == 1
    assert provider.create_calls == 0

    failing = _ProbeProvider(ConnectionError("bridge unavailable"))
    result = check_network_service(failing)
    assert result.reason_code is DependencyReasonCode.CONNECTION_FAILED
    assert failing.create_calls == 0






class _SensitiveNetworkDependency(NetworkServiceDependency):
    @property
    def dependency_id(self) -> str:
        return "network:sensitive"

    def redacted_metadata(self):
        return {
            "provider": "safe-name",
            "password": "secret",
            "api_key": "secret-key",
        }


def test_health_monitor_strips_unapproved_sensitive_metadata() -> None:
    dependency = _SensitiveNetworkDependency()
    registration = DependencyRegistration(
        dependency.dependency_id,
        dependency.kind,
        lambda item: DependencyCheckResult.success(),
    )
    monitor = DependencyHealthMonitor(bind_dependencies([dependency], [registration]))
    record = monitor.record(dependency.dependency_id)
    assert record is not None
    assert record.redacted_metadata == {"provider": "safe-name"}


def test_health_monitor_initial_pending_success_and_no_overlap() -> None:
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

    dependency = ExecutableDependency("bash")
    monitor = DependencyHealthMonitor(
        bind_dependencies([dependency], [_registration("bash", check=checker)]),
        interval_s=3600,
    )
    pending = monitor.record("executable:bash")
    assert pending is not None
    assert pending.status is DependencyStatus.PENDING

    async def exercise() -> None:
        first = asyncio.create_task(monitor.run_once())
        await asyncio.to_thread(entered.wait, 2)
        second = asyncio.create_task(monitor.run_once())
        await asyncio.sleep(0.05)
        assert calls == 1
        release.set()
        await asyncio.gather(first, second)

    asyncio.run(exercise())
    record = monitor.record("executable:bash")
    assert record is not None
    assert record.status is DependencyStatus.AVAILABLE
    assert record.reason_code is None


def test_health_monitor_enforces_four_check_concurrency() -> None:
    active = 0
    maximum = 0
    lock = threading.Lock()
    entered_four = threading.Event()
    release = threading.Event()

    def checker(dependency):
        nonlocal active, maximum
        del dependency
        with lock:
            active += 1
            maximum = max(maximum, active)
            if active == 4:
                entered_four.set()
        release.wait(timeout=5)
        with lock:
            active -= 1
        return DependencyCheckResult.success()

    dependencies = [ExecutableDependency(f"command-{index}") for index in range(6)]
    registrations = [
        _registration(f"command-{index}", check=checker) for index in range(6)
    ]
    monitor = DependencyHealthMonitor(
        bind_dependencies(dependencies, registrations),
        max_concurrency=4,
    )

    async def exercise() -> None:
        task = asyncio.create_task(monitor.run_once())
        assert await asyncio.to_thread(entered_four.wait, 2)
        await asyncio.sleep(0.05)
        assert maximum == 4
        release.set()
        await task

    asyncio.run(exercise())
    assert maximum == 4


def test_api_reads_cached_state_and_dependency_failure_does_not_affect_ready(
    tmp_path: Path,
) -> None:
    _write_config(tmp_path)
    calls = 0

    def checker(dependency):
        nonlocal calls
        del dependency
        calls += 1
        return DependencyCheckResult.failure(DependencyReasonCode.NOT_FOUND)

    application = create_app(
        deployment=HubDeployment.custom(
            load_hub_config(start=tmp_path),
            _factory_for("missing"),
            MockTranscriptionEndpoint(["unused"]),
        ),
        dependency_registry=[_registration("missing", check=checker)],
        dependency_check_interval_s=3600,
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
    _write_config(tmp_path)
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
        deployment=HubDeployment.custom(
            load_hub_config(start=tmp_path),
            _factory_for("sometimes"),
            MockTranscriptionEndpoint(["unused"]),
        ),
        dependency_registry=[_registration("sometimes", check=checker)],
        dependency_check_interval_s=3600,
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
    _write_config(tmp_path)
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
        deployment=HubDeployment.custom(
            load_hub_config(start=tmp_path),
            _factory_for("slow"),
            MockTranscriptionEndpoint(["unused"]),
        ),
        dependency_registry=[_registration("slow", check=checker)],
        dependency_check_interval_s=3600,
    )
    with TestClient(application) as client:
        assert entered.wait(timeout=2)
        response = client.post("/admin/dependencies/check")

        assert response.status_code == 200
        assert calls == 1
        release.set()


def test_registry_mismatch_fails_testclient_lifespan(tmp_path: Path) -> None:
    _write_config(tmp_path)
    application = create_app(
        deployment=HubDeployment.custom(
            load_hub_config(start=tmp_path),
            _factory_for("unregistered"),
            MockTranscriptionEndpoint(["unused"]),
        ),
        dependency_registry=(),
    )
    with pytest.raises(DependencyContractError, match="executable:unregistered"):
        with TestClient(application):
            pass
