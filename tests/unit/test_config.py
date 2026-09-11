from dataclasses import replace
from pathlib import Path

import pytest
from config_support import write_config
from roboshed.models import ActionVerdict, Operation
from roboshed.tools.utils import check_allow_deny_permission

from robosprawl.hub.utils import load_hub


def test_load_hub_resolves_base_and_relative_paths(tmp_path):
    write_config(tmp_path)
    hub = load_hub(start=tmp_path)
    assert hub.name == "TestHub"
    assert hub.sandbox.root == tmp_path / "sandbox"
    assert hub.sandbox.projects_dir == tmp_path / "sandbox/projects"
    assert hub.sandbox.readonly_dir == tmp_path / "sandbox/readonly"
    assert hub.sandbox.shared_dir == tmp_path / "sandbox/workspace"
    assert hub.logging.path == tmp_path / "technical_logs/backend.jsonl"
    assert (hub.dependency_health.interval_s, hub.dependency_health.timeout_s) == (
        60,
        20,
    )
    assert (
        hub.sandbox.logs,
        hub.sandbox.snapshots,
        hub.sandbox.memory,
    ) == (
        Path("conversation_logs"),
        Path("conversation_snapshots"),
        Path("persistent_memory"),
    )


def test_sandbox_rejects_absolute_area_name(tmp_path):
    write_config(tmp_path)
    hub = load_hub(start=tmp_path)
    with pytest.raises(ValueError):
        replace(hub.sandbox, readonly="/etc")


def test_hub_accepts_explicit_absolute_sandbox(tmp_path):
    write_config(tmp_path)
    hub = load_hub(start=tmp_path)
    selected = replace(
        hub, sandbox=replace(hub.sandbox, root=tmp_path / "elsewhere")
    )
    assert selected.project("test").root == tmp_path / "elsewhere/projects/test"


def test_hub_rejects_technical_log_inside_projects(tmp_path):
    write_config(tmp_path)
    hub = load_hub(start=tmp_path)
    with pytest.raises(ValueError, match="outside projects"):
        replace(
            hub,
            logging=replace(
                hub.logging, path=hub.sandbox.projects_dir / "backend.jsonl"
            ),
        )


@pytest.mark.parametrize("level", ["trace", "verbose", ""])
def test_unknown_log_level_is_rejected(tmp_path, level):
    write_config(tmp_path)
    with pytest.raises(ValueError, match="console_level"):
        replace(load_hub(start=tmp_path).logging, console_level=level)


@pytest.mark.parametrize("on_error", ["ignore", "warn", None])
def test_unknown_file_error_policy_is_rejected(tmp_path, on_error):
    write_config(tmp_path)
    with pytest.raises(ValueError, match="on_error"):
        replace(load_hub(start=tmp_path).logging, on_error=on_error)


def test_orchestrator_sandbox_permits_writes_at_project_root(
    tmp_path: Path,
) -> None:
    """Configured project paths match the shared permission boundaries."""
    write_config(tmp_path)
    project = load_hub(start=tmp_path).project("My Project")
    sandbox = project.sandbox
    assert sandbox.root == project.sandbox.resolved_root
    assert sandbox.root != project.root
    assert sandbox.shared_dir == project.sandbox.resolved_root / "workspace"

    perms = sandbox.permissions()

    def _verdict(location: Path, op: Operation) -> ActionVerdict:
        return check_allow_deny_permission(
            location=location,
            op_type=op,
            takes_precedence=perms.takes_precedence,
            allow_rules=perms.allow,
            deny_rules=perms.deny,
            default_verdict=perms.default_verdict,
            base_path=perms.base,
        )

    in_project = project.root / "draft.md"
    in_readonly = sandbox.readonly_dir / "ref.md"
    assert _verdict(in_project, Operation.CREATE) == ActionVerdict.allow
    assert _verdict(in_readonly, Operation.CREATE) == ActionVerdict.deny


@pytest.mark.parametrize(
    ("name", "slug"),
    [
        ("My Project", "my-project"),
        ("my_project", "my-project"),
        ("Café Plan", "cafe-plan"),
        ("  __My   Project!!  ", "my-project"),
        ("Alpha/Bravo: Charlie", "alphabravo-charlie"),
        ("one---two", "one-two"),
    ],
)
def test_project_paths_slug_derivation(tmp_path: Path, name: str, slug: str) -> None:
    write_config(tmp_path)

    paths = load_hub(start=tmp_path).project(name)

    assert paths.slug == slug


def test_project_paths_uses_slug_as_project_identity(tmp_path: Path) -> None:
    write_config(tmp_path)

    mixed_case = load_hub(start=tmp_path).project("My Project")
    lower_case = load_hub(start=tmp_path).project("my project")

    assert mixed_case.slug == lower_case.slug
    assert mixed_case.root == lower_case.root


@pytest.mark.parametrize("name", ["", "   ", "東京"])
def test_project_paths_rejects_unsluggable_names(tmp_path: Path, name: str) -> None:
    write_config(tmp_path)

    with pytest.raises(RuntimeError, match="Project name"):
        load_hub(start=tmp_path).project(name)


def test_project_paths_derives_project_layout_without_creating_dirs(
    tmp_path: Path,
) -> None:
    write_config(tmp_path)

    paths = load_hub(start=tmp_path).project("My Project")
    root = tmp_path / "sandbox" / "projects" / "my-project"

    assert paths.root == root
    assert paths.logs == root / "conversation_logs"
    assert paths.snapshots == root / "conversation_snapshots"
    assert paths.memory == root / "persistent_memory"
    assert not root.exists()


@pytest.mark.parametrize("folder", ["../outside", "/outside"])
def test_shared_project_rejects_escaping_artifacts(tmp_path, folder):
    write_config(tmp_path)
    project = load_hub(start=tmp_path).project("My Project")
    with pytest.raises(ValueError):
        project.artifact_dir(folder)


def test_shared_paths_reject_symlink_escapes(tmp_path):
    write_config(tmp_path)
    config = load_hub(start=tmp_path)
    project = config.project("My Project")
    project.root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (project.root / "documents").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        project.artifact_dir("documents")
    (project.root / "persistent_memory").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        config.project("My Project")
    project.sandbox.shared_dir.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        config.sandbox.shared_dir


@pytest.mark.parametrize(
    "source",
    [
        "NAME = 'incomplete'",
        "def build_config(): return {}",
        "raise ValueError('broken choice')",
        "not valid python!",
    ],
)
def test_loader_reports_invalid_constant_file(tmp_path, source):
    path = tmp_path / "hub.config.py"
    path.write_text(source)
    with pytest.raises(RuntimeError, match="Invalid hub config") as error:
        load_hub(config_file=path)
    assert str(path) in str(error.value)
    assert error.value.__cause__ is not None


def test_loader_rejects_json_configuration(tmp_path):
    path = tmp_path / "hub.config.json"
    path.write_text("{}")
    with pytest.raises(RuntimeError, match="Python file"):
        load_hub(config_file=path)
