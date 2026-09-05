"""Configuration can be inspected and imported independently of startup."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from robosprawl.api.dependencies import inspect_dependencies
from robosprawl.deployment import HubDeployment
from robosprawl.hub import load_hub_config
from robosprawl.settings import DeploymentSettings


@pytest.fixture
def config_file(tmp_path):
    example = Path(__file__).resolve().parents[2] / "hub.config.json.example"
    path = tmp_path / "hub.config.json"
    path.write_text(example.read_text())
    return path


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


