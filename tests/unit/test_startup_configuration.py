"""Configuration can be inspected and imported independently of startup."""

import logging
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from deployment_support import BuiltAgents, configured_hub, deferred_deployment
from fastapi.testclient import TestClient
from roboz import Agent
from roboz.endpoints.adapters.openai_compatible import OpenAICompatibleAdapter
from roboz.models import AgentMode
from roboz.tools import stop

from robozium.api.app import create_app
from robozium.hub.application import Hub
from robozium.hub.utils import load_hub, load_hub_settings


@pytest.fixture
def config_file(tmp_path):
    example = Path(__file__).resolve().parents[2] / "hub.config.py"
    path = tmp_path / "config/hub.config.py"
    path.parent.mkdir()
    path.write_text(example.read_text())
    return path


def test_imports_do_not_boot_or_modify_process_paths(tmp_path):
    code = """
import logging, pathlib, tempfile
from roboz.runtime.persistence import mark_conversation_active, active_marker_paths
root = pathlib.Path.cwd()
logs = root / 'logs'
mark_conversation_active(agent_dir=logs / 'orchestrator', conversation_id='existing')
before_temp = tempfile.gettempdir()
before_handlers = list(logging.getLogger('robozium').handlers)
import robozium.api.app
import robozium.api.run_manager
assert len(active_marker_paths(logs, {'orchestrator'})) == 1
assert tempfile.gettempdir() == before_temp
assert logging.getLogger('robozium').handlers == before_handlers
assert not (root / '.artifacts').exists()
assert callable(robozium.api.app.mock_app)
"""
    env = {
        **os.environ,
        "ROBOZIUM_CONFIG": str(tmp_path / "missing.json"),
        "ROBOZIUM_ROOT": str(tmp_path),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=tmp_path,
        env=env,
        check=True,
        timeout=15,
    )


def test_settings_loading_and_validation_precede_private_code(config_file):
    package = config_file.parent / "local/tools/broken"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("raise ValueError('private import')\n")
    (package / "requirements.txt").touch()
    settings = load_hub_settings(config_file=config_file)
    assert not settings.sandbox.root.exists()
    with pytest.raises(ValueError, match="hub name must be nonempty"):
        Hub(replace(settings, name=""))
    with pytest.raises(RuntimeError, match="private import"):
        Hub(settings)


def test_runtimes_from_shared_settings_have_independent_selection(config_file):
    settings = load_hub_settings(config_file=config_file)
    first, second = Hub(settings), Hub(settings)
    spare = list(settings.models.values())[1]
    first.model_selector.select(spare.dependency_id)
    first.definition.set_capability_selection({})
    assert first.model_selector.selected_endpoint is spare
    assert second.model_selector.selected_endpoint is settings.default_model
    assert first.definition is not second.definition
    assert first.definition.capability_selection == {}
    assert second.definition.capability_selection is None
    assert not settings.sandbox.root.exists()


def test_logging_uses_each_explicit_app_config(config_file):
    config = load_hub(config_file=config_file)

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter
        return BuiltAgents(
            Agent(
                name="root",
                mode=AgentMode.DETERMINISTIC,
                agent_endpoint=None,
                default_tools=[stop],
                event_sinks=event_sinks,
            )
        )

    for name in ["first", "second"]:
        path = config_file.parent / name / "backend.jsonl"
        selected = configured_hub(config, logging=replace(config.settings.logging, path=path))
        app = create_app(
            deployment=configured_hub(
                selected,
                deployment=deferred_deployment(factory),
                transcription_endpoint=None,
            ),
        )
        assert not path.exists(), "app construction must not configure logging"
        with TestClient(app):
            logging.getLogger("robozium.test").info("message-%s", name)
        assert f"message-{name}" in path.read_text()
    assert (
        "message-second" not in (config_file.parent / "first/backend.jsonl").read_text()
    )


def test_custom_root_and_memory_compile_one_dependency_contract(
    config_file, monkeypatch
):
    monkeypatch.delenv("LOCAL_MODEL_KEY", raising=False)
    adapter = OpenAICompatibleAdapter(
        api_name="local",
        base_url="http://127.0.0.1:12345/v1",
        api_key_env="LOCAL_MODEL_KEY",
    )
    root, spare, memory = (
        adapter.chat_endpoint(model=f"{role}-model", max_context_tokens=32768)
        for role in ("root", "spare", "memory")
    )
    hub = load_hub(config_file=config_file)
    hub = configured_hub(
        hub,
        models={"Root": root, "Spare": spare},
        default_model=root,
        memory_endpoint=memory,
    )
    agent, _ = hub.configure_deployment(
        hub.project("demo").sandbox,
        "demo",
        endpoint_getter=lambda: hub.model_selector.selected_endpoint,
    ).build()
    bound = (*agent.external_dependencies(), *hub.settings.models.values())
    assert {
        item.dependency_id for item in bound if item.dependency_id.startswith("model:")
    } == {
        root.dependency_id,
        spare.dependency_id,
        memory.dependency_id,
    }
    assert hub.model_selector.selected_endpoint is root
    hub.model_selector.select(spare.dependency_id)
    configured = hub.configure_deployment(
        hub.project("demo").sandbox,
        "demo",
        endpoint_getter=lambda: hub.model_selector.selected_endpoint,
    ).build()
    assert configured[1][0].agent_endpoint is memory


def test_explicit_config_path_wins_over_environment(config_file, monkeypatch):
    monkeypatch.setenv("ROBOZIUM_CONFIG", str(config_file.parent / "missing.json"))
    assert load_hub(config_file=config_file).settings.name == "Robozium"
    with pytest.raises(RuntimeError, match="Missing hub config"):
        load_hub()
    monkeypatch.setenv("ROBOZIUM_CONFIG", str(config_file))
    expected = (config_file.parent / "../Robozium-Hub").resolve()
    assert load_hub().settings.sandbox.root == expected


def test_checked_in_config_accepts_container_paths(
    config_file, monkeypatch, tmp_path
):
    hub_root = tmp_path / "container-hub"
    logs = tmp_path / "container-logs"
    monkeypatch.setenv("ROBOZIUM_HUB_ROOT", str(hub_root))
    monkeypatch.setenv("ROBOZIUM_LOG_DIR", str(logs))

    hub = load_hub(config_file=config_file)

    assert hub.settings.sandbox.root == hub_root
    assert hub.settings.logging.path == logs / "backend.jsonl"


@pytest.mark.parametrize(
    "choice",
    ["SANDBOX", "MEMORY_ENDPOINT", "SUBAGENTS"],
)
def test_required_choice_fails_during_load(config_file, choice):
    with config_file.open("a") as file:
        file.write(f"\ndel {choice}\n")
    with pytest.raises(RuntimeError, match=choice):
        load_hub(config_file=config_file)


@pytest.mark.parametrize("change", ["unknown", "duplicate", "empty-label"])
def test_invalid_model_selection_fails_before_construction(config_file, change):
    hub = load_hub(config_file=config_file)
    if change == "unknown":
        with pytest.raises(ValueError, match="default model"):
            configured_hub(hub, models={"Only spare": list(hub.settings.models.values())[1]})
    else:
        models = (
            {"One": hub.settings.default_model, "Two": hub.settings.default_model}
            if change == "duplicate"
            else {"": hub.settings.default_model}
        )
        with pytest.raises(ValueError):
            configured_hub(hub, models=models)


@pytest.mark.parametrize(
    "settings",
    [
        {"interval_s": 0},
        {"timeout_s": -1},
        {"interval_s": float("inf")},
        {"timeout_s": float("nan")},
    ],
)
def test_invalid_health_settings_fail_during_configuration(config_file, settings):
    hub = load_hub(config_file=config_file)
    with pytest.raises(ValueError, match="finite and positive"):
        replace(hub.settings.dependency_health, **settings)


@pytest.mark.parametrize(
    "folder", ["../escape", "/escape", "conversation_logs", "conversation_logs/nested"]
)
def test_persistence_folders_cannot_escape_or_overlap(config_file, folder):
    hub = load_hub(config_file=config_file)
    with pytest.raises(ValueError):
        configured_hub(hub, sandbox=replace(hub.settings.sandbox, memory=Path(folder)))


@pytest.mark.parametrize("conflicting", [False, True])
def test_overlapping_app_lifespans_preserve_existing_logging(config_file, conflicting):
    config = load_hub(config_file=config_file)

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter
        return BuiltAgents(
            Agent(
                name="root",
                mode=AgentMode.DETERMINISTIC,
                agent_endpoint=None,
                default_tools=[stop],
                event_sinks=event_sinks,
            )
        )

    def app(selected):
        return create_app(
            deployment=configured_hub(
                selected,
                deployment=deferred_deployment(factory),
                transcription_endpoint=None,
            ),
        )

    with TestClient(app(config)) as first:
        if conflicting:
            other = configured_hub(
                config,
                logging=replace(
                    config.settings.logging, path=config_file.parent / "conflicting.jsonl"
                ),
            )
            with pytest.raises(RuntimeError, match="different configuration"):
                with TestClient(app(other)):
                    pytest.fail("conflicting app started")
            assert not other.settings.logging.path.exists()
        else:
            with TestClient(app(config)) as second:
                assert second.get("/ready").status_code == 200
        logging.getLogger("robozium.test").info("first-app-still-active")
        assert first.get("/ready").status_code == 200
        assert "first-app-still-active" in config.settings.logging.path.read_text()


def test_project_service_owns_startup_layout_validation(config_file):
    from robozium.api.project_service import ProjectService

    config = load_hub(config_file=config_file)
    unexpected = config.settings.sandbox.root / "misplaced"
    unexpected.mkdir(parents=True)
    service = ProjectService(config, SimpleNamespace())
    with pytest.raises(ValueError, match="Unexpected folders.*misplaced"):
        service.recover()
    unexpected.rmdir()
    (config.settings.sandbox.root / "note.txt").write_text("root files are permitted")
    service.recover()
    assert service.create("New Project") == "new-project"
    project = config.project("New Project")
    assert project.root.is_dir()
    assert not any(
        path.exists() for path in (project.logs, project.snapshots, project.memory)
    )


def test_config_loads_fresh_endpoints_without_materialization(config_file, monkeypatch):
    for key in ("OPENROUTER_API_KEY", "CEREBRAS_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    first = load_hub(config_file=config_file)
    second = load_hub(config_file=config_file)
    assert first.settings.default_model is not second.settings.default_model
    assert first.model_selector is not second.model_selector
    assert first.settings.default_model.dependency_id == second.settings.default_model.dependency_id
    assert not first.settings.sandbox.root.exists()
    with pytest.raises(TypeError):
        first.settings.models["extra"] = first.settings.default_model


def test_constants_control_the_complete_deployment(config_file, monkeypatch):
    monkeypatch.chdir(config_file.parent)
    with config_file.open("a") as file:
        file.write("""
from roboz.deployment import Capability, DeployableAgent, ToolLabel
from roboz.tools import stop

MODELS = {"Alternate": FLASH}
DEFAULT_MODEL = FLASH
DEPENDENCY_HEALTH = DependencyHealthSettings(interval_s=17, timeout_s=3)
MEMORY_ENDPOINT = GPT_OSS
REVIEWER = DeployableAgent(
    name="reviewer", system_prompt="Review the project.",
    capabilities=(Capability(label=ToolLabel("stop"), value=stop),),
)
REVIEWER.set_agent_endpoint(GPT_OSS)
SUBAGENTS = (REVIEWER,)
""")
    hub = load_hub(config_file=config_file)
    project = hub.project("custom")
    deployment = hub.configure_deployment(
        project.sandbox, project.slug, endpoint_getter=lambda: hub.settings.default_model
    ).build()
    assert tuple(hub.settings.models) == ("Alternate",)
    assert hub.model_selector.selected_endpoint is hub.settings.models["Alternate"]
    assert (
        hub.settings.dependency_health.interval_s == 17 and hub.settings.dependency_health.timeout_s == 3
    )
    assert hub.additional_capabilities == ()
    agent, (background,) = deployment
    assert "reviewer" in {tool.name for tool in agent.tools}
    assert agent.initial_messages[0] == project.memory
    assert "Project: custom" in agent.initial_messages[1]
    assert background.agent_endpoint.dependency_id == "model:cerebras:gpt-oss-120b"
    assert not hub.settings.sandbox.root.exists()


def test_checked_in_config_has_only_constant_declarations(config_file):
    import ast

    tree = ast.parse(config_file.read_text())
    assert all(
        isinstance(node, (ast.Import, ast.ImportFrom, ast.AnnAssign))
        for node in tree.body
    )
    assert not any(
        isinstance(node, (ast.FunctionDef, ast.ClassDef, ast.Lambda))
        for node in ast.walk(tree)
    )


@pytest.mark.parametrize("getter", [42, "invalid"])
def test_hub_requires_a_callable_deployment_override(config_file, getter):
    with pytest.raises(TypeError, match="deployment override must be callable"):
        configured_hub(load_hub(config_file=config_file), deployment=getter)
