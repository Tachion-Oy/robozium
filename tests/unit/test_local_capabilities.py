"""Private modules extend the existing deployment without tracked config edits."""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from config_support import write_config
from deployment_support import configured_deployment, foreground_agent
from roboz.llm import MockLLMEndpoint

from robozium.hub.local import load_local_capabilities
from robozium.hub.utils import load_hub


def _package(root: Path, source: str) -> Path:
    package = root / "local"
    package.mkdir(parents=True, exist_ok=True)
    entrypoint = package / "__init__.py"
    entrypoint.write_text(source)
    return entrypoint


@pytest.mark.parametrize("source", [None, "", "CAPABILITIES = ()", "CAPABILITIES = []"])
def test_missing_or_empty_exports_preserve_configured_capabilities(tmp_path, source):
    config = write_config(tmp_path)
    original = load_hub(config_file=config).additional_capabilities
    if source is not None:
        _package(tmp_path, source)
    else:
        (tmp_path / "local").mkdir()
    hub = load_hub(config_file=config)
    assert hub.additional_capabilities == original
    assert not hub.sandbox.root.exists()


@pytest.mark.parametrize("collection", ["(CAPABILITY,)", "[CAPABILITY]"])
def test_relative_imports_follow_config_path_and_append_in_order(
    tmp_path, monkeypatch, collection
):
    root = tmp_path / "selected"
    root.mkdir()
    config = write_config(root)
    original = load_hub(config_file=config).additional_capabilities
    entrypoint = _package(
        root, f"from .tools import CAPABILITY\nCAPABILITIES = {collection}\n"
    )
    (entrypoint.parent / "tools.py").write_text(
        "from roboz.deployment import Capability\n"
        "from roboz.tools import stop\n"
        "CAPABILITY = Capability(tools=(stop.copy(name='local_finish'),))\n"
    )
    unrelated = tmp_path / "unrelated"
    _package(unrelated, "raise AssertionError('wrong private package')")
    monkeypatch.chdir(unrelated)
    before = sys.path.copy()
    hub = load_hub(config_file=config)
    assert sys.path == before
    assert hub.additional_capabilities[:-1] == original
    assert hub.additional_capabilities[-1].tools[0].name == "local_finish"
    assert isinstance(hub.additional_capabilities, tuple)
    assert not hub.sandbox.root.exists()


def test_successful_imports_are_cached_but_configuration_directories_are_isolated(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    for root in (first, second):
        entrypoint = _package(root, "from .tools import CAPABILITIES\n")
        (entrypoint.parent / "tools.py").write_text(
            "from roboz.deployment import Capability\nCAPABILITIES = (Capability(),)\n"
        )
    a = load_local_capabilities(first)
    b = load_local_capabilities(second)
    assert a[0] is not b[0]
    (first / "local/__init__.py").write_text("raise AssertionError('reimported')")
    assert load_local_capabilities(first)[0] is a[0]
    assert load_local_capabilities(second)[0] is b[0]


@pytest.mark.parametrize("export", ["None", "42", "'tools'", "{}", "set()"])
def test_invalid_collection_reports_local_and_config_paths(tmp_path, export):
    config = write_config(tmp_path)
    entrypoint = _package(tmp_path, f"CAPABILITIES = {export}\n")
    with pytest.raises(RuntimeError, match="CAPABILITIES must be a list or tuple") as error:
        load_hub(config_file=config)
    assert str(config) in str(error.value)
    assert str(entrypoint) in str(error.value)
    assert isinstance(error.value.__cause__, RuntimeError)
    assert isinstance(error.value.__cause__.__cause__, TypeError)


@pytest.mark.parametrize(
    "source",
    ["not valid python!", "raise ValueError('broken local choice')", "from .missing import x"],
)
def test_failed_import_reports_path_and_can_be_retried(tmp_path, source):
    entrypoint = _package(tmp_path, source)
    with pytest.raises(RuntimeError, match="Invalid local capabilities") as error:
        load_local_capabilities(tmp_path)
    assert str(entrypoint) in str(error.value)
    assert error.value.__cause__ is not None
    entrypoint.write_text("CAPABILITIES = ()\n")
    assert load_local_capabilities(tmp_path) == ()


@pytest.mark.parametrize("failure", ["raise ValueError('broken')", "CAPABILITIES = None"])
def test_failed_package_discards_imported_submodules(tmp_path, failure):
    entrypoint = _package(tmp_path, f"from .tools import CAPABILITIES\n{failure}\n")
    helper = entrypoint.parent / "tools.py"
    helper.write_text("CAPABILITIES = []\n")
    with pytest.raises(RuntimeError):
        load_local_capabilities(tmp_path)
    helper.write_text(
        "from roboz.deployment import Capability\nCAPABILITIES = [Capability()]\n"
    )
    entrypoint.write_text("from .tools import CAPABILITIES\n")
    assert len(load_local_capabilities(tmp_path)) == 1


def test_local_tool_executes_through_real_project_deployment(tmp_path):
    config = write_config(tmp_path)
    _package(
        tmp_path,
        "from dataclasses import dataclass\n"
        "from roboz.deployment import AgentCapability, Capability\n"
        "from roboz.tools import stop\n"
        "@dataclass(frozen=True)\n"
        "class LocalTools(AgentCapability):\n"
        "    @property\n"
        "    def required_attributes(self): return {}\n"
        "    def build(self, agent, pipe):\n"
        "        return Capability(tools=(stop.copy(name='local_finish'),))\n"
        "CAPABILITIES = (LocalTools(),)\n",
    )
    hub = load_hub(config_file=config)
    project = hub.project("private-tool")
    endpoint = MockLLMEndpoint(
        [{"action": "local_finish", "rationale": "test local tool", "value": "private-done"}]
    )
    agents = configured_deployment(
        project, endpoint, additional_capabilities=hub.additional_capabilities
    )
    agent = foreground_agent(agents, omit_skills=True)
    assert "local_finish" in {tool.name for tool in agent.tools}
    result, _ = agent.invoke()
    assert result.value == "private-done"


def test_declared_tool_installs_requirements_before_import_and_joins_deployment(
    tmp_path, monkeypatch
):
    config = write_config(tmp_path)
    entrypoint = _package(
        tmp_path,
        "from robozium.hub.local import LocalTool\n"
        "CAPABILITIES = (LocalTool('tools:LocalTools', 'requirements.txt'),)\n",
    )
    (entrypoint.parent / "requirements.txt").write_text("local-marker==1\n")
    (entrypoint.parent / "tools.py").write_text(
        "import local_marker\n"
        "from roboz.deployment import Capability\n"
        "from roboz.tools import stop\n"
        "class LocalTools:\n"
        "    required_attributes = {}\n"
        "    def build(self, agent, pipe):\n"
        "        return Capability(tools=(stop.copy(name=local_marker.TOOL_NAME),))\n"
    )
    installed: list[Path] = []

    def install(command, **_kwargs):
        target = Path(command[command.index("--target") + 1])
        target.mkdir(parents=True, exist_ok=True)
        (target / "local_marker.py").write_text("TOOL_NAME = 'local_finish'\n")
        installed.append(target)
        assert command[command.index("-r") + 1] == str(
            entrypoint.parent / "requirements.txt"
        )
        return SimpleNamespace(returncode=0, stderr="", stdout="")

    monkeypatch.setattr("robozium.hub.local.subprocess.run", install)
    original_path = sys.path.copy()
    try:
        hub = load_hub(config_file=config)
        assert len(installed) == 1
        assert str(installed[0]) in sys.path
        assert load_hub(config_file=config).additional_capabilities[-1] is (
            hub.additional_capabilities[-1]
        )
        assert len(installed) == 1
        project = hub.project("private-tool")
        endpoint = MockLLMEndpoint(
            [{"action": "local_finish", "rationale": "test local tool", "value": "done"}]
        )
        agents = configured_deployment(
            project, endpoint, additional_capabilities=hub.additional_capabilities
        )
        result, _ = foreground_agent(agents, omit_skills=True).invoke()
        assert result.value == "done"
    finally:
        sys.path[:] = original_path
        sys.modules.pop("local_marker", None)


@pytest.mark.parametrize(
    ("entrypoint", "requirements", "reason"),
    [
        ("tools:LocalTools", "missing.txt", "requirements file"),
        ("missing:LocalTools", "requirements.txt", "module: missing"),
        ("../tools:LocalTools", "requirements.txt", "entrypoint"),
        ("tools:LocalTools", "../outside.txt", "requirements file"),
    ],
)
def test_invalid_local_tool_contract_fails_before_install(
    tmp_path, monkeypatch, entrypoint, requirements, reason
):
    package = _package(
        tmp_path,
        "from robozium.hub.local import LocalTool\n"
        f"CAPABILITIES = (LocalTool({entrypoint!r}, {requirements!r}),)\n",
    ).parent
    (package / "tools.py").write_text("class LocalTools: pass\n")
    (package / "requirements.txt").write_text("")
    monkeypatch.setattr(
        "robozium.hub.local.subprocess.run",
        lambda *_args, **_kwargs: pytest.fail("installation must not run"),
    )
    with pytest.raises(RuntimeError, match=reason):
        load_local_capabilities(tmp_path)


def test_dependency_failure_can_be_fixed_and_retried(tmp_path, monkeypatch):
    package = _package(
        tmp_path,
        "from robozium.hub.local import LocalTool\n"
        "CAPABILITIES = (LocalTool('tools:LocalTools', 'requirements.txt'),)\n",
    ).parent
    (package / "tools.py").write_text(
        "from roboz.deployment import Capability\n"
        "class LocalTools:\n"
        "    required_attributes = {}\n"
        "    def build(self, agent, pipe): return Capability()\n"
    )
    (package / "requirements.txt").write_text("missing-package==1\n")
    failures = iter((1, 0))
    monkeypatch.setattr(
        "robozium.hub.local.subprocess.run",
        lambda *_args, **_kwargs: SimpleNamespace(
            returncode=next(failures), stderr="dependency conflict", stdout=""
        ),
    )
    before = sys.path.copy()
    with pytest.raises(RuntimeError, match="dependency conflict"):
        load_local_capabilities(tmp_path)
    assert sys.path == before
    try:
        assert len(load_local_capabilities(tmp_path)) == 1
    finally:
        sys.path[:] = before


@pytest.mark.parametrize(
    ("source", "reason"),
    [
        ("def wrong(): return object()\n", "expected an AgentCapability"),
        ("def wrong(): raise ValueError('bad tool')\n", "tools:wrong: bad tool"),
    ],
)
def test_local_tool_factory_errors_identify_the_tool(tmp_path, monkeypatch, source, reason):
    package = _package(
        tmp_path,
        "from robozium.hub.local import LocalTool\n"
        "CAPABILITIES = (LocalTool('tools:wrong', 'requirements.txt'),)\n",
    ).parent
    (package / "tools.py").write_text(source)
    (package / "requirements.txt").write_text("")
    monkeypatch.setattr(
        "robozium.hub.local.subprocess.run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=0, stderr="", stdout=""),
    )
    before = sys.path.copy()
    with pytest.raises(RuntimeError, match=reason):
        load_local_capabilities(tmp_path)
    assert sys.path == before
