"""Configuration can be inspected and imported independently of startup."""

import json
import logging
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from roboz import Agent
from roboz.tools import stop

from robosprawl.api.app import create_app
from robosprawl.api.dependencies import inspect_dependencies
from robosprawl.composition import RootAgentBundle
from robosprawl.deployment import HubDeployment
from robosprawl.hub import load_hub_config
from robosprawl.settings import DeploymentSettings


@pytest.fixture
def config_file(tmp_path):
    example = Path(__file__).resolve().parents[2] / "hub.config.json.example"
    path = tmp_path / "hub.config.json"
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
import robosprawl.api.live
import robosprawl.api.mock
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
    config = load_hub_config(config_file=config_file)

    def factory(project, *, endpoint_getter, event_sinks):
        return RootAgentBundle(
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
            deployment=HubDeployment.custom(selected, factory, None),
            dependency_registry=(),
        )
        assert not path.exists(), "app construction must not configure logging"
        with TestClient(app):
            logging.getLogger("robosprawl.test").info("message-%s", name)
        assert f"message-{name}" in path.read_text()
    assert (
        "message-second" not in (config_file.parent / "first/backend.jsonl").read_text()
    )


def custom_settings():
    def endpoint(name):
        return dict(
            label=name,
            model=name,
            api_name="local",
            base_url="http://127.0.0.1:12345/v1",
            api_key_env="LOCAL_MODEL_KEY",
            max_context_tokens=32768,
        )

    return dict(
        endpoints={"root": endpoint("root-model"), "memory": endpoint("memory-model")},
        selectable_models=["root"],
        default_model="root",
        memory_model="memory",
    )


def test_custom_root_and_memory_compile_one_dependency_contract(
    config_file, monkeypatch
):
    monkeypatch.delenv("LOCAL_MODEL_KEY", raising=False)
    data = json.loads(config_file.read_text())
    data["deployment"] = custom_settings()
    config_file.write_text(json.dumps(data))
    config = load_hub_config(config_file=config_file)
    deployment = HubDeployment.standard(config)
    bound = inspect_dependencies(
        deployment.orchestrator_factory,
        project=config.project("demo"),
        endpoint_getter=lambda: deployment.model_selector.selected_endpoint,
        registrations=deployment.dependency_registry,
        hub_dependencies=deployment.inspectable_endpoints,
    )
    ids = {item.dependency.dependency_id for item in bound}
    assert {item for item in ids if item.startswith("model:")} == {
        "model:local:root-model",
        "model:local:memory-model",
    }
    assert deployment.model_selector.selected_model_id == "model:local:root-model"
    custom = HubDeployment.custom(
        config,
        deployment.orchestrator_factory,
        None,
        model_selector=deployment.model_selector,
        dependency_registry=deployment.dependency_registry,
    )
    assert custom.model_selector is deployment.model_selector
    assert custom.dependency_registry == deployment.dependency_registry


def test_explicit_config_path_wins_over_environment(config_file, monkeypatch):
    monkeypatch.setenv("ROBOSPRAWL_CONFIG", str(config_file.parent / "missing.json"))
    assert load_hub_config(config_file=config_file).name == "RoboSprawl"
    with pytest.raises(RuntimeError, match="Missing hub config"):
        load_hub_config()
    monkeypatch.setenv("ROBOSPRAWL_CONFIG", str(config_file))
    assert load_hub_config().sandbox.root == config_file.parent / ".runtime/data"


@pytest.mark.parametrize("key", ["logs", "snapshots", "memory"])
def test_required_persistence_keys_fail_during_config_load(config_file, key):
    data = json.loads(config_file.read_text())
    del data["project"][key]
    config_file.write_text(json.dumps(data))
    with pytest.raises(RuntimeError, match="missing required folders"):
        load_hub_config(config_file=config_file)


@pytest.mark.parametrize("change", ["unknown", "duplicate", "url", "service"])
def test_invalid_deployment_fails_before_construction(change):
    settings = custom_settings()
    if change == "unknown":
        settings["memory_model"] = "missing"
    elif change == "duplicate":
        settings["selectable_models"] = ["root", "root"]
    elif change == "url":
        settings["endpoints"]["root"]["base_url"] = "file:///tmp/model"
    else:
        settings["endpoints"]["memory"]["base_url"] = "http://different-service/v1"
    with pytest.raises(ValidationError):
        DeploymentSettings.model_validate(settings)


@pytest.mark.parametrize(
    "folders",
    [
        dict(memory="../escape"),
        dict(memory="conversation_logs"),
        dict(memory="conversation_logs/nested"),
    ],
)
def test_persistence_folders_cannot_escape_or_overlap(config_file, folders):
    data = json.loads(config_file.read_text())
    data["project"].update(folders)
    config_file.write_text(json.dumps(data))
    with pytest.raises(RuntimeError):
        load_hub_config(config_file=config_file)


@pytest.mark.parametrize("conflicting", [False, True])
def test_overlapping_app_lifespans_preserve_existing_logging(config_file, conflicting):
    config = load_hub_config(config_file=config_file)

    def factory(project, *, endpoint_getter, event_sinks):
        return RootAgentBundle(
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
            deployment=HubDeployment.custom(selected, factory, None),
            dependency_registry=(),
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
