"""CLI-created private packages extend live deployments across API restarts."""

import json
import os
import subprocess
import sys
from importlib.metadata import version
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
from robozium.hub.local import LocalPackages, load_local_packages
from robozium.hub.utils import load_hub


def _load(config_dir):
    return load_local_packages(config_dir).capabilities


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
    for implementation in tmp_path.glob("*/*/*/tool.py"):
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
            hub.project("quotes").sandbox, "quotes", endpoint_getter=lambda: hub.settings.default_model
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
    for path, label in (
        ("tools/z", "last"), ("tools/a", "middle"),
        ("skills/z", "first"), ("imports/copied/tools/inner", "copied"),
    ):
        package = _package(root, path, "from .implementation import CAPABILITY\n")
        (package / "implementation.py").write_text(_source(label))
    (root / "local/imports/copied/robozium.json").write_text('{"tools": ["tools/inner"]}')
    (root / "local/imports/copied/__init__.py").write_text("raise AssertionError('folder')\n")
    (root / "local/imports/copied/tools/__init__.py").write_text("raise AssertionError('parent')\n")
    for parent in ("local", "local/tools", "local/skills"):
        (root / parent / "__init__.py").write_text("raise AssertionError('old registry')\n")
    _package(root, "tools/container/nested", "raise AssertionError('nested')\n")
    _package(tmp_path, source="raise AssertionError('wrong config')\n")
    monkeypatch.chdir(tmp_path)
    before = sys.path.copy()
    hub = load_hub(config_file=config)
    assert [cap.label.name for cap in hub.additional_capabilities] == [
        "first", "middle", "last", "copied"
    ]
    assert sys.path == before
    assert not hub.settings.sandbox.root.exists()


def test_missing_directories_and_successful_loads_are_cached_and_isolated(tmp_path):
    assert _load(tmp_path / "empty") == {}
    for root in (tmp_path / "first", tmp_path / "second"):
        _package(root)
    first = load_local_packages(tmp_path / "first")
    second = load_local_packages(tmp_path / "second")
    assert next(iter(first.capabilities.values()))[0] is not next(iter(second.capabilities.values()))[0]
    _package(tmp_path / "first", source="raise AssertionError('reimported')\n")
    assert load_local_packages(tmp_path / "first") is first


@pytest.mark.parametrize("source", ["", "CAPABILITY = None", "CAPABILITY = object()"])
def test_invalid_exports_report_package_and_config(tmp_path, source):
    config = write_config(tmp_path)
    package = _package(tmp_path, source=source)
    with pytest.raises(RuntimeError, match="Capability instance") as error:
        load_hub(config_file=config)
    assert str(package) in str(error.value) and str(config) in str(error.value)


@pytest.mark.parametrize("source", ["bad python!", "raise ValueError('broken')", "from .missing import x"])
def test_failed_imports_discard_submodules_and_remain_retryable(tmp_path, source):
    package = _package(tmp_path, source="from .helper import CAPABILITY\n" + source)
    helper = package / "helper.py"
    helper.write_text(_source("before"))
    with pytest.raises(RuntimeError, match="Invalid local capabilities"):
        _load(tmp_path)
    helper.write_text(_source("after_repair"))
    (package / "__init__.py").write_text("from .helper import CAPABILITY\n")
    assert next(iter(_load(tmp_path).values()))[0].label.name == "after_repair"


def test_duplicate_names_identify_both_packages_and_allow_repair(tmp_path):
    first = _package(tmp_path, "tools/one")
    second = _package(tmp_path, "skills/two")
    with pytest.raises(RuntimeError, match="duplicate capability name 'private'") as error:
        _load(tmp_path)
    assert str(first) in str(error.value) and str(second) in str(error.value)
    (first / "__init__.py").write_text(_source("unique"))
    assert len(_load(tmp_path)) == 2


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
        assert target.parent == tmp_path / ".runtime/local-deps"
        target.mkdir(parents=True)
        (target / "private_marker.py").write_text("VALUE = 1\n")
        requirements = [command[i + 1] for i, value in enumerate(command) if value == "-r"]
        assert requirements == [str(p / "requirements.txt") for p in (first, second)]
        constraints = Path(command[command.index("--constraint") + 1]).read_text()
        assert f"roboz=={version("roboz")}\n" in constraints
        assert kwargs["timeout"] == 180
        installed.append(target)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr("robozium.hub.local.subprocess.run", install)
    before = sys.path.copy()
    try:
        assert len(_load(tmp_path)) == 2
        assert str(installed[0]) in sys.path
        _load(tmp_path)
        assert len(installed) == 1
    finally:
        sys.path[:] = before
        sys.modules.pop("private_marker", None)


@pytest.mark.parametrize("requirements", [
    ("private-shared==1\n", "private-shared==2\n"),
    ("", "roboz==0.0.0\n"),
])
def test_real_dependency_conflicts_fail_before_imports_and_allow_repair(tmp_path, monkeypatch, requirements):
    marker = tmp_path / "imported"
    source = f"from pathlib import Path\nPath({str(marker)!r}).touch()\n"
    first = _package(tmp_path, source=source + _source("first"), requirements=requirements[0])
    second = _package(tmp_path, "skills/second", source=source + _source("second"), requirements=requirements[1])
    monkeypatch.setenv("UV_OFFLINE", "1")
    monkeypatch.setenv("UV_CACHE_DIR", str(tmp_path / "uv-cache"))
    before = sys.path.copy()
    with pytest.raises(RuntimeError, match="Dependencies must be compatible") as error:
        _load(tmp_path)
    assert str(first / "requirements.txt") in str(error.value)
    assert str(second / "requirements.txt") in str(error.value)
    detail = str(error.value).split("application environment: ", 1)[1]
    assert "No solution found" in detail
    assert requirements[1].strip() in detail
    assert (requirements[0].strip() or f"roboz=={version("roboz")}") in detail
    assert sys.path == before
    assert not marker.exists()
    for package in (first, second):
        (package / "requirements.txt").write_text("")
    assert len(_load(tmp_path)) == 2
    assert marker.exists()


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
        _load(tmp_path)


def test_empty_requirements_skip_installation(tmp_path, monkeypatch):
    _package(tmp_path, requirements=" \n")
    monkeypatch.setattr("robozium.hub.local.which", lambda _: None)
    assert len(_load(tmp_path)) == 1


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
            _load(tmp_path)
        assert sys.path == before
    (package / "__init__.py").write_text(_source())
    try:
        assert len(_load(tmp_path)) == 1
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


def test_removing_package_on_restart_preserves_other_saved_choices(tmp_path):
    config = write_config(tmp_path)
    _generate(tmp_path, "tool")
    _generate(tmp_path, "skill", "local/skills/customer_guide")
    app = create_app(deployment=load_hub(config_file=config))
    choices = {"simpsons_quotes": True, "customer_guide": True}
    try:
        client = TestClient(app)
        assert client.post("/projects", json={"name": "restart"}).status_code == 200
        assert client.post("/capabilities/restart", json=choices).status_code == 200
    finally:
        app.state.run_manager.shutdown()
    assert _restart(config)["effective"]["customer_guide"] == "on_demand"
    rmtree(tmp_path / "local/skills/customer_guide")
    removed = _restart(config)
    assert removed["effective"]["simpsons_quotes"] is True
    assert "customer_guide" not in removed["effective"]
    assert removed["saved"] == choices


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
    assert mock["effective"]["added"] is False
    assert {"mock_information", "mock_guidance"} <= mock["effective"].keys()


def _imported(root, name, source=None, catalog='{"tools": ["tools/inner"]}', requirements=""):
    folder = root / "local/imports" / name
    _package(root, f"imports/{name}/tools/inner", source=source, requirements=requirements)
    (folder / "robozium.json").write_text(catalog)
    return folder


@pytest.mark.parametrize(
    "name, catalog, source, reason",
    [
        ("legacy", None, None, "legacy: robozium.json is missing"),
        ("broken_json", "{", None, "not valid JSON"),
        ("missing_package", '{"tools": ["tools/absent"]}', None, "package tools/absent"),
        ("bad_code", '{"tools": ["tools/inner"]}', "raise ValueError('broken')", "broken"),
        ("wrong_kind", '{"skills": ["tools/inner"]}', None, "listed under skills"),
        ("duplicate", '{"tools": ["tools/inner"]}', _source("good"), "duplicate capability name 'good'"),
    ],
)
def test_a_broken_imported_folder_is_skipped_and_reported(tmp_path, name, catalog, source, reason):
    _imported(tmp_path, "a_good", source=_source("good"))
    folder = _imported(tmp_path, name, source=source, catalog=catalog or "")
    if catalog is None:
        (folder / "robozium.json").unlink()
    loaded = load_local_packages(tmp_path)
    assert [cap.label.name for values in loaded.capabilities.values() for cap in values] == ["good"]
    assert list(loaded.broken) == [name]
    assert reason in loaded.broken[name]
    assert not any(module.startswith("_robozium_local_") and f".imports.{name}" in module for module in sys.modules)


def test_an_imported_folder_whose_requirements_conflict_is_skipped(tmp_path, monkeypatch):
    _imported(tmp_path, "a_good", source=_source("good"), requirements="good-package\n")
    _imported(tmp_path, "b_conflict", source=_source("conflict"), requirements="conflicting-package\n")
    installs = []

    def install(config_dir, requirements):
        installs.append(sorted(file.parent.parent.parent.name for file in requirements))
        if any("conflicting" in file.read_text() for file in requirements):
            raise RuntimeError("Could not install local requirements")
        return tmp_path / "deps"

    monkeypatch.setattr("robozium.hub.local._install_requirements", install)
    loaded = load_local_packages(tmp_path)
    assert [cap.label.name for values in loaded.capabilities.values() for cap in values] == ["good"]
    assert "Could not install" in loaded.broken["b_conflict"]
    # Together first; then the folders one at a time.
    assert installs == [["a_good", "b_conflict"], ["a_good"], ["a_good", "b_conflict"]]


def test_a_broken_package_in_tools_still_stops_startup(tmp_path):
    _imported(tmp_path, "a_good", source=_source("good"))
    _package(tmp_path, "tools/broken", source="raise ValueError('developer package')")
    with pytest.raises(RuntimeError, match="developer package"):
        load_local_packages(tmp_path)


def test_hidden_staging_folders_under_imports_are_not_loaded(tmp_path):
    _package(tmp_path, "imports/.upload-1/imports/staged")
    assert load_local_packages(tmp_path) == LocalPackages({}, {})


def test_an_imported_folder_linked_from_elsewhere_is_reported(tmp_path):
    outside = _package(tmp_path / "outside", "imports/linked/tools/inner").parents[2]
    (outside / "robozium.json").write_text('{"tools": ["tools/inner"]}')
    (tmp_path / "local/imports").mkdir(parents=True)
    (tmp_path / "local/imports/linked").symlink_to(outside)
    assert "must stay inside" in load_local_packages(tmp_path).broken["linked"]


def test_an_imported_folder_that_names_a_built_in_is_skipped_at_startup(tmp_path):
    _imported(tmp_path, "a_good", source=_source("good"))
    _imported(tmp_path, "b_clash", source=_source("stop"))
    hub = load_hub(config_file=write_config(tmp_path))
    assert "conflicts with a built-in" in hub.local_packages.broken["b_clash"]
    assert [cap.label.name for cap in hub.additional_capabilities] == ["good"]
    names = {row["name"] for row in TestClient(create_app(deployment=hub)).get("/capabilities").json()}
    assert "good" in names
