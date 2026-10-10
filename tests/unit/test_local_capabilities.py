"""CLI-created private packages extend live deployments across API restarts."""

import json
import os
import subprocess
import sys
from pathlib import Path
from shutil import rmtree
from types import SimpleNamespace

import pytest
from config_support import write_config
from deployment_support import foreground_agent
from fastapi.testclient import TestClient
from roboz.deployment import SkillLoading
from roboz.llm import MockLLMEndpoint

from robozium.api.app import create_app
from robozium.hub.local import load_local_capabilities
from robozium.hub.utils import load_hub


def _source(label="private"):
    return (
        "from roboz.deployment import Capability, ToolLabel\n"
        "from roboz.tools import stop\n"
        f"CAPABILITY = Capability(label=ToolLabel({label!r}, selectable=True), value=stop)\n"
    )


def _package(root, path="tools/private", source=None, requirements=""):
    package = root / "local" / path
    package.mkdir(parents=True, exist_ok=True)
    (package / "__init__.py").write_text(_source() if source is None else source)
    (package / "requirements.txt").write_text(requirements)
    return package


def _generate(root, kind, path=None):
    command = [str(Path(sys.executable).with_name("roboz")), kind, "init"]
    if path:
        command.extend(("--path", path))
    subprocess.run(command, cwd=root, check=True, capture_output=True, text=True)


def test_cli_packages_are_selectable_and_execute_through_live_deployment(tmp_path):
    config = write_config(tmp_path)
    _generate(tmp_path, "tool")
    _generate(tmp_path, "skill")
    for implementation in (tmp_path / "local").glob("*/*/tool.py"):
        implementation.write_text(
            implementation.read_text().replace("choice(QUOTES)", "'generated quote'")
        )
    hub = load_hub(config_file=config)
    labels = {label.name: label for label in hub.capabilities()}
    assert labels["simpsons_quotes"].selectable
    assert labels["simpsons_quotes"].kind == "tool"
    skill = labels["simpsons_quotes_skill"]
    assert skill.selectable and skill.kind == "skill"
    assert skill.loading == SkillLoading.ON_DEMAND
    for selected in ("simpsons_quotes", "simpsons_quotes_skill"):
        definition = hub.configure_deployment(
            hub.project("quotes").sandbox, "quotes", endpoint_getter=lambda: hub.default_model
        )
        definition.set_capability_selection({selected: True})
        responses = []
        if selected.endswith("_skill"):
            responses.append({"action": selected, "rationale": "test"})
        responses.append({"action": f"get_{selected}", "rationale": "test"})
        definition.set_agent_endpoint(MockLLMEndpoint(responses))
        agent = foreground_agent(definition.build())
        assert agent.invoke()[0].value == "generated quote"
        definition.set_capability_selection({})
        excluded, _ = definition.build()
        assert not any(tool.name.startswith("get_simpsons") for tool in excluded.tools)
        assert not excluded.skills


def test_config_relative_discovery_order_and_relative_imports_ignore_parent_code(
    tmp_path, monkeypatch
):
    root = tmp_path / "selected"
    root.mkdir()
    config = write_config(root)
    for path, label in (("tools/z", "last"), ("tools/a", "middle"), ("skills/z", "first")):
        package = _package(root, path, "from .implementation import CAPABILITY\n")
        (package / "implementation.py").write_text(_source(label))
    for parent in ("local", "local/tools", "local/skills"):
        (root / parent / "__init__.py").write_text("raise AssertionError('old registry')\n")
    _package(root, "tools/container/nested", "raise AssertionError('nested')\n")
    _package(tmp_path, source="raise AssertionError('wrong config')\n")
    monkeypatch.chdir(tmp_path)
    before = sys.path.copy()
    hub = load_hub(config_file=config)
    assert [cap.label.name for cap in hub.additional_capabilities] == ["first", "middle", "last"]
    assert sys.path == before
    assert not hub.sandbox.root.exists()


def test_missing_directories_and_successful_loads_are_cached_and_isolated(tmp_path):
    assert load_local_capabilities(tmp_path / "empty") == ()
    for root in (tmp_path / "first", tmp_path / "second"):
        _package(root)
    first = load_local_capabilities(tmp_path / "first")
    second = load_local_capabilities(tmp_path / "second")
    assert first[0] is not second[0]
    _package(tmp_path / "first", source="raise AssertionError('reimported')\n")
    assert load_local_capabilities(tmp_path / "first") is first


@pytest.mark.parametrize("source", ["", "CAPABILITY = None", "CAPABILITY = object()"])
def test_invalid_exports_report_package_and_config(tmp_path, source):
    config = write_config(tmp_path)
    package = _package(tmp_path, source=source)
    with pytest.raises(RuntimeError, match="CAPABILITY.*Capability instance") as error:
        load_hub(config_file=config)
    assert str(package) in str(error.value) and str(config) in str(error.value)


@pytest.mark.parametrize("source", ["bad python!", "raise ValueError('broken')", "from .missing import x"])
def test_failed_imports_discard_submodules_and_remain_retryable(tmp_path, source):
    package = _package(tmp_path, source="from .helper import CAPABILITY\n" + source)
    helper = package / "helper.py"
    helper.write_text(_source("before"))
    previous = helper.stat()
    with pytest.raises(RuntimeError, match="Invalid local capabilities"):
        load_local_capabilities(tmp_path)
    helper.write_text(_source("after_"))
    os.utime(helper, ns=(previous.st_atime_ns, previous.st_mtime_ns))
    (package / "__init__.py").write_text("from .helper import CAPABILITY\n")
    assert load_local_capabilities(tmp_path)[0].label.name == "after_"


def test_duplicate_names_identify_both_packages_and_allow_repair(tmp_path):
    first = _package(tmp_path, "tools/one")
    second = _package(tmp_path, "skills/two")
    with pytest.raises(RuntimeError, match="duplicate capability name 'private'") as error:
        load_local_capabilities(tmp_path)
    assert str(first) in str(error.value) and str(second) in str(error.value)
    (first / "__init__.py").write_text(_source("unique"))
    assert len(load_local_capabilities(tmp_path)) == 2


def test_builtin_collision_is_an_actionable_live_startup_error(tmp_path):
    _package(tmp_path, source=_source("stop"))
    hub = load_hub(config_file=write_config(tmp_path))
    with pytest.raises(ValueError, match="Local capability 'stop'.*built-in.*rename"):
        create_app(deployment=hub)


def test_requirements_are_installed_together_before_any_import(tmp_path, monkeypatch):
    first = _package(tmp_path, "skills/a", "import private_marker\n" + _source("a"), "marker==1\n")
    second = _package(tmp_path, "tools/b", source=_source("b"))
    installed = []

    def install(command, **kwargs):
        target = Path(command[command.index("--target") + 1])
        target.mkdir(parents=True)
        (target / "private_marker.py").write_text("VALUE = 1\n")
        requirements = [command[i + 1] for i, value in enumerate(command) if value == "-r"]
        assert requirements == [str(p / "requirements.txt") for p in (first, second)]
        constraints = Path(command[command.index("--constraint") + 1]).read_text()
        assert "roboz==0.9.1\n" in constraints
        assert kwargs["timeout"] == 180
        installed.append(target)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("robozium.hub.local.subprocess.run", install)
    before = sys.path.copy()
    try:
        assert len(load_local_capabilities(tmp_path)) == 2
        assert str(installed[0]) in sys.path
        load_local_capabilities(tmp_path)
        assert len(installed) == 1
    finally:
        sys.path[:] = before
        sys.modules.pop("private_marker", None)


@pytest.mark.parametrize("invalid", ["missing_requirements", "requirements_link", "entrypoint_link", "package_link", "directory_link"])
def test_invalid_files_fail_before_installation(tmp_path, monkeypatch, invalid):
    package = _package(tmp_path, requirements="something==1\n")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "__init__.py").write_text(_source())
    (outside / "requirements.txt").write_text("")
    if invalid == "missing_requirements":
        (package / "requirements.txt").unlink()
    elif invalid in {"requirements_link", "entrypoint_link"}:
        file = "requirements.txt" if invalid == "requirements_link" else "__init__.py"
        (package / file).unlink()
        (package / file).symlink_to(outside / file)
    else:
        target = package if invalid == "package_link" else package.parent
        rmtree(target)
        target.symlink_to(outside, target_is_directory=True)
    monkeypatch.setattr(
        "robozium.hub.local.subprocess.run", lambda *a, **k: pytest.fail("must validate first")
    )
    with pytest.raises(RuntimeError, match="missing or invalid local file|invalid local capability directory"):
        load_local_capabilities(tmp_path)


def test_empty_requirements_skip_installation(tmp_path, monkeypatch):
    _package(tmp_path, requirements=" \n")
    monkeypatch.setattr("robozium.hub.local.which", lambda _: None)
    assert len(load_local_capabilities(tmp_path)) == 1


def test_dependency_and_import_failures_restore_path_and_can_be_retried(tmp_path, monkeypatch):
    package = _package(tmp_path, requirements="missing==1\n", source="raise ValueError('bad import')")
    results = iter((1, 0, 0))
    monkeypatch.setattr(
        "robozium.hub.local.subprocess.run",
        lambda *a, **k: SimpleNamespace(returncode=next(results), stderr="dependency conflict", stdout=""),
    )
    before = sys.path.copy()
    for error in ("dependency conflict", "bad import"):
        with pytest.raises(RuntimeError, match=error):
            load_local_capabilities(tmp_path)
        assert sys.path == before
    (package / "__init__.py").write_text(_source())
    try:
        assert len(load_local_capabilities(tmp_path)) == 1
    finally:
        sys.path[:] = before


def _restart(config, mode="live"):
    script = """
import json
from fastapi.testclient import TestClient
from robozium.api.app import live_app, mock_app
app = live_app() if MODE == 'live' else mock_app()
try:
    client = TestClient(app)
    catalogue = client.get('/capabilities').json()
    saved = client.get('/capabilities/restart').json()
    definition = app.state.hub.definition
    names = {label['name'] for label in catalogue}
    definition.set_capability_selection({k: v for k, v in saved.items() if k in names})
    print(json.dumps({'catalogue': catalogue, 'saved': saved, 'effective': definition.resolve_capabilities()}))
finally:
    app.state.run_manager.shutdown()
""".replace("MODE", repr(mode))
    result = subprocess.run(
        [sys.executable, "-c", script], cwd=config.parent,
        env={**os.environ, "ROBOZIUM_CONFIG": str(config)},
        capture_output=True, text=True, check=True, timeout=30,
    )
    return json.loads(result.stdout)


def test_fresh_api_processes_rediscover_packages_and_preserve_saved_selections(tmp_path):
    config = write_config(tmp_path)
    _generate(tmp_path, "tool", "local/tools/original")
    app = create_app(deployment=load_hub(config_file=config))
    try:
        client = TestClient(app)
        assert client.post("/projects", json={"name": "restart"}).status_code == 200
        assert client.post("/capabilities/restart", json={"original": True}).status_code == 200
    finally:
        app.state.run_manager.shutdown()
    assert _restart(config)["effective"]["original"] is True
    _generate(tmp_path, "skill", "local/skills/added")
    added = _restart(config)
    assert added["saved"] == {"original": True}
    assert added["effective"]["added"] is False
    entrypoint = tmp_path / "local/tools/original/__init__.py"
    entrypoint.write_text(entrypoint.read_text().replace("selectable=True", "selectable=False"))
    edited = _restart(config)
    assert not next(label for label in edited["catalogue"] if label["name"] == "original")["selectable"]
    rmtree(entrypoint.parent)
    removed = _restart(config)
    assert "original" not in removed["effective"]
    assert removed["saved"] == {"original": True}
    mock = _restart(config, "mock")
    assert "added" not in mock["effective"]
    assert {"mock_information", "mock_guidance"} <= mock["effective"].keys()
