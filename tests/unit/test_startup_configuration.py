"""Configuration can be inspected and imported independently of startup."""

import logging
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest
from deployment_support import BuiltAgents
from fastapi.testclient import TestClient
from roboshed.dependency_health import inspect_dependencies
from roboz import Agent
from roboz.tools import stop
from roboz_endpoints.adapters.openai_compatible import OpenAICompatibleAdapter

from robosprawl.api.app import create_app
from robosprawl.hub.utils import load_hub


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
before_handlers = list(logging.getLogger('robosprawl').handlers)
import robosprawl.api.app
import robosprawl.api.run_manager
assert len(active_marker_paths(logs, {'orchestrator'})) == 1
assert tempfile.gettempdir() == before_temp
assert logging.getLogger('robosprawl').handlers == before_handlers
assert not (root / '.artifacts').exists()
assert callable(robosprawl.api.app.mock_app)
"""
    env = {
        **os.environ,
        "ROBOSPRAWL_CONFIG": str(tmp_path / "missing.json"),
        "ROBOSPRAWL_ROOT": str(tmp_path),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    subprocess.run(
        [sys.executable, "-B", "-c", code],
        cwd=tmp_path,
        env=env,
        check=True,
        timeout=15,
    )


def test_logging_uses_each_explicit_app_config(config_file):
    config = load_hub(config_file=config_file)

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter
        return BuiltAgents(
            Agent(
                name="root",
                is_agentic=False,
                agent_endpoint=None,
                default_tools=[stop],
                event_sinks=event_sinks,
            )
        )

    for name in ["first", "second"]:
        path = config_file.parent / name / "backend.jsonl"
        selected = replace(config, logging=replace(config.logging, path=path))
        app = create_app(
            deployment=replace(
                selected, deployment=factory, transcription_endpoint=None
            ),
        )
        assert not path.exists(), "app construction must not configure logging"
        with TestClient(app):
            logging.getLogger("robosprawl.test").info("message-%s", name)
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
    hub = replace(
        hub,
        models={"Root": root, "Spare": spare},
        default_model=root,
        memory_endpoint=memory,
    )
    bound = inspect_dependencies(
        lambda sandbox: hub.configure_deployment(
            sandbox,
            "demo",
            endpoint_getter=lambda: hub.model_selector.selected_endpoint,
        ),
        sandbox=hub.sandbox,
        registrations=hub.dependency_registry,
        additional_dependencies=tuple(hub.models.values()),
    )
    assert {
        item.dependency.dependency_id
        for item in bound
        if item.dependency.dependency_id.startswith("model:")
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
    )
    assert configured.agent.background_agents[0].agent_endpoint is memory


def test_explicit_config_path_wins_over_environment(config_file, monkeypatch):
    monkeypatch.setenv("ROBOSPRAWL_CONFIG", str(config_file.parent / "missing.json"))
    assert load_hub(config_file=config_file).name == "RoboSprawl"
    with pytest.raises(RuntimeError, match="Missing hub config"):
        load_hub()
    monkeypatch.setenv("ROBOSPRAWL_CONFIG", str(config_file))
    expected = (config_file.parent / "../RoboSprawl").resolve()
    assert load_hub().sandbox.root == expected


@pytest.mark.parametrize(
    "choice",
    ["SANDBOX", "CAPABILITIES", "MEMORY_ENDPOINT", "SUBAGENTS", "INTERACTION_MODE"],
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
            replace(hub, models={"Only spare": list(hub.models.values())[1]})
    else:
        models = (
            {"One": hub.default_model, "Two": hub.default_model}
            if change == "duplicate"
            else {"": hub.default_model}
        )
        with pytest.raises(ValueError):
            replace(hub, models=models)


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
        replace(hub.dependency_health, **settings)


@pytest.mark.parametrize(
    "folder", ["../escape", "/escape", "conversation_logs", "conversation_logs/nested"]
)
def test_persistence_folders_cannot_escape_or_overlap(config_file, folder):
    hub = load_hub(config_file=config_file)
    with pytest.raises(ValueError):
        replace(hub, sandbox=replace(hub.sandbox, memory=Path(folder)))


@pytest.mark.parametrize("conflicting", [False, True])
def test_overlapping_app_lifespans_preserve_existing_logging(config_file, conflicting):
    config = load_hub(config_file=config_file)

    def factory(sandbox, project_slug, *, endpoint_getter, event_sinks):
        del sandbox, project_slug, endpoint_getter
        return BuiltAgents(
            Agent(
                name="root",
                is_agentic=False,
                agent_endpoint=None,
                default_tools=[stop],
                event_sinks=event_sinks,
            )
        )

    def app(selected):
        return create_app(
            deployment=replace(
                selected, deployment=factory, transcription_endpoint=None
            ),
        )

    with TestClient(app(config)) as first:
        if conflicting:
            other = replace(
                config,
                logging=replace(
                    config.logging, path=config_file.parent / "conflicting.jsonl"
                ),
            )
            with pytest.raises(RuntimeError, match="different configuration"):
                with TestClient(app(other)):
                    pytest.fail("conflicting app started")
            assert not other.logging.path.exists()
        else:
            with TestClient(app(config)) as second:
                assert second.get("/ready").status_code == 200
        logging.getLogger("robosprawl.test").info("first-app-still-active")
        assert first.get("/ready").status_code == 200
        assert "first-app-still-active" in config.logging.path.read_text()


def test_project_service_owns_startup_layout_validation(config_file):
    from robosprawl.api.project_service import ProjectService

    config = load_hub(config_file=config_file)
    unexpected = config.sandbox.root / "misplaced"
    unexpected.mkdir(parents=True)
    service = ProjectService(config, SimpleNamespace())
    with pytest.raises(ValueError, match="Unexpected folders.*misplaced"):
        service.recover()
    unexpected.rmdir()
    (config.sandbox.root / "note.txt").write_text("root files are permitted")
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
    assert first.default_model is not second.default_model
    assert first.model_selector is not second.model_selector
    assert first.default_model.dependency_id == second.default_model.dependency_id
    assert not first.sandbox.root.exists()
    with pytest.raises(TypeError):
        first.models["extra"] = first.default_model


def test_constants_control_the_complete_deployment(config_file, monkeypatch):
    monkeypatch.chdir(config_file.parent)
    with config_file.open("a") as file:
        file.write("""
from roboz.deployment import DeployableAgent

MODELS = {"Alternate": FLASH}
DEFAULT_MODEL = FLASH
DEPENDENCY_HEALTH = DependencyHealthSettings(interval_s=17, timeout_s=3)
CAPABILITIES = (Compactification(threshold_percent=42),)
MEMORY_ENDPOINT = GPT_OSS
SUBAGENTS = (DeployableAgent(name="reviewer", agent_endpoint=GPT_OSS),)
INTERACTION_MODE = None
""")
    hub = load_hub(config_file=config_file)
    project = hub.project("custom")
    deployment = hub.configure_deployment(
        project.sandbox, project.slug, endpoint_getter=lambda: hub.default_model
    )
    assert tuple(hub.models) == ("Alternate",)
    assert hub.model_selector.selected_endpoint is hub.models["Alternate"]
    assert (
        hub.dependency_health.interval_s == 17 and hub.dependency_health.timeout_s == 3
    )
    assert deployment.additional_capabilities[-1].threshold_percent == 42
    assert deployment.agent.subagents == tuple(hub.subagents)
    assert deployment.agent.agent_names(include_background=False) == {
        "orchestrator", "reviewer"
    }
    assert hub.interaction_mode is None
    assert deployment.agent.interaction_mode is None
    assert deployment.agent.initial_messages[0] == project.memory
    assert "Project: custom" in deployment.agent.initial_messages[1]
    assert (
        deployment.agent.background_agents[0].agent_endpoint.dependency_id
        == "model:cerebras:gpt-oss-120b"
    )
    assert not hub.sandbox.root.exists()


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
