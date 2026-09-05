import json
from pathlib import Path

import pytest
from roboz_shed.models import ActionVerdict, Operation
from roboz_shed.tools.utils import check_allow_deny_permission

from robosprawl.deployment import (
    DEFAULT_MEMORY_MODEL,
    DEFAULT_ORCHESTRATOR_MODEL,
    standard_factory,
)
from robosprawl.hub import (
    load_hub_config,
    manifest_project,
    project_paths,
)
from robosprawl.identifiers import (
    COMPACTIFY_MESSAGES_TOOL_NAME,
    CONSOLIDATE_MEMORY_TOOL_NAME,
    PURGE_LOGS_TOOL_NAME,
    PURGE_MEMORY_TOOL_NAME,
    PURGE_SNAPSHOTS_TOOL_NAME,
    SLEEP_BETWEEN_RUNS_TOOL_NAME,
    SNAPSHOT_CONVERSATIONS_TOOL_NAME,
)
from robosprawl.workspace import build_workspace_permissions


def _default_config(name: str = "TestHub") -> dict[str, dict[str, object]]:
    """A complete nested hub config: a sandbox section and an open project section."""
    return {
        "hub": {"name": name},
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
            "root": "workspace",
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


def _write_config(
    tmp_path: Path, config: dict[str, dict[str, object]] | None = None
) -> None:
    (tmp_path / "hub.config.json").write_text(
        json.dumps(config if config is not None else _default_config()),
        encoding="utf-8",
    )


def test_load_hub_config_resolves_base_and_relative_paths(tmp_path: Path) -> None:
    _write_config(tmp_path)

    config = load_hub_config(start=tmp_path)

    assert config.name == "TestHub"
    assert config.sandbox.resolved_root == tmp_path / "workspace"
    assert config.sandbox.projects_dir == tmp_path / "workspace" / "projects"
    assert config.sandbox.readonly_dir == tmp_path / "workspace" / "readonly"
    assert config.sandbox.workspace_dir == tmp_path / "workspace" / "workspace"
    assert config.logging.console_level == "INFO"
    assert config.logging.path == tmp_path / "technical_logs" / "backend.jsonl"
    # Per-project subfolder names, applied under each project's own root.
    assert config.project_subdirs == {
        "logs": "conversation_logs",
        "snapshots": "conversation_snapshots",
        "memory": "persistent_memory",
    }


def test_load_hub_config_rejects_absolute_folder_name(tmp_path: Path) -> None:
    config = _default_config()
    config["sandbox"]["readonly"] = "/etc"
    _write_config(tmp_path, config)

    with pytest.raises(RuntimeError, match="sandbox.readonly"):
        load_hub_config(start=tmp_path)


def test_load_hub_config_rejects_absolute_base_dir(tmp_path: Path) -> None:
    config = _default_config()
    config["sandbox"]["root"] = str(tmp_path / "workspace")
    _write_config(tmp_path, config)

    with pytest.raises(RuntimeError, match="sandbox.root"):
        load_hub_config(start=tmp_path)


def test_load_hub_config_rejects_technical_log_inside_projects(
    tmp_path: Path,
) -> None:
    config = _default_config()
    config["logging"]["file"]["path"] = "workspace/projects/backend.jsonl"
    _write_config(tmp_path, config)

    with pytest.raises(RuntimeError, match="outside projects"):
        load_hub_config(start=tmp_path)


@pytest.mark.parametrize("level", ["trace", "verbose", ""])
def test_load_hub_config_rejects_unknown_log_level(tmp_path: Path, level: str) -> None:
    config = _default_config()
    config["logging"]["console"]["level"] = level
    _write_config(tmp_path, config)

    with pytest.raises(RuntimeError, match="logging.console.level"):
        load_hub_config(start=tmp_path)


@pytest.mark.parametrize("on_error", ["ignore", "warn", None])
def test_load_hub_config_rejects_unknown_file_error_policy(
    tmp_path: Path, on_error: object
) -> None:
    config = _default_config()
    config["logging"]["file"]["on_error"] = on_error
    _write_config(tmp_path, config)

    with pytest.raises(RuntimeError, match="logging.file.on_error"):
        load_hub_config(start=tmp_path)


def test_standard_factory_builds_librarian_as_non_agentic_workflow(
    tmp_path: Path,
) -> None:
    _write_config(tmp_path)
    project = project_paths("My Project", start=tmp_path)

    bundle = standard_factory()(project, event_sinks=())
    (librarian,) = bundle.background_agents

    assert librarian.name == "librarian"
    assert librarian.agent_endpoint is None
    assert librarian.is_agentic is False
    assert [tool.name for tool in librarian.default_tools] == [
        SNAPSHOT_CONVERSATIONS_TOOL_NAME,
        CONSOLIDATE_MEMORY_TOOL_NAME,
        PURGE_LOGS_TOOL_NAME,
        PURGE_SNAPSHOTS_TOOL_NAME,
        PURGE_MEMORY_TOOL_NAME,
        SLEEP_BETWEEN_RUNS_TOOL_NAME,
    ]


def test_standard_factory_uses_canonical_glm_5_3_for_memory_tools() -> None:
    factory = standard_factory()

    assert factory.librarian is not None
    assert factory.librarian.snapshot_endpoint is DEFAULT_MEMORY_MODEL
    assert DEFAULT_MEMORY_MODEL.dependency_id == "model:openrouter:z-ai/glm-5.3"
    assert factory.orchestrator.subagents == ()


def test_standard_factory_reuses_configured_endpoints_in_derived_tools(
    tmp_path: Path,
) -> None:
    _write_config(tmp_path)
    project = project_paths("My Project", start=tmp_path)

    bundle = standard_factory()(project, event_sinks=())
    compactifier = next(
        tool
        for tool in bundle.agent.default_tools
        if tool.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    (librarian,) = bundle.background_agents
    snapshot, consolidate = librarian.default_tools[:2]

    assert compactifier.dependencies[0].resource is DEFAULT_ORCHESTRATOR_MODEL
    assert snapshot.dependencies[0].resource is DEFAULT_MEMORY_MODEL
    assert consolidate.dependencies[0].resource is DEFAULT_MEMORY_MODEL


def test_standard_factory_uses_project_paths_and_default_tools(
    tmp_path: Path,
) -> None:
    _write_config(tmp_path)
    project = project_paths("My Project", start=tmp_path)

    bundle = standard_factory()(project, event_sinks=())
    orchestrator = bundle.agent

    # The librarian is surfaced so the manager can cancel it independently.
    assert [agent.name for agent in bundle.background_agents] == ["librarian"]
    assert orchestrator.initial_messages == [project.memory.resolve()]
    assert [tool.name for tool in orchestrator.default_tools] == [
        COMPACTIFY_MESSAGES_TOOL_NAME,
        "start_background_agent_librarian",
    ]
    # Per-agent conversation logs live under the project's log root.
    assert orchestrator.pipe.data_path == project.logs.resolve() / "orchestrator"
    active_names = {tool.name for tool in orchestrator.active_tools.values()}
    assert {"run_file_command", "apply_patch", "prompt_user", "stop"} <= active_names
    assert set(orchestrator._auto_loaded_skills) == {"cli_tools", "file_editing"}


def test_standard_factory_derives_librarian_scan_set_from_composition() -> None:
    """The librarian watches exactly the deployment's conversation-writing agents.

    Regression guard for the old hand-synced ``agent_names`` set in the hub: the
    scan set is now derived from the orchestrator + its subagents.
    """
    assert standard_factory().agent_names() == {
        "orchestrator",
    }


def test_orchestrator_sandbox_permits_writes_at_project_root(
    tmp_path: Path,
) -> None:
    """The project's data folder is writable under the orchestrator's own policy.

    This is the cross-repo coupling made concrete: the hub writes the project's
    records under ``project.root``, and the orchestrator's sandbox permits writes
    exactly there (and denies the read-only tier), because both the write path and
    the permission pattern come from the single ``projects_dir`` config value.
    The constructor derives its permissions from ``project.sandbox`` + slug, so
    this pins the same rule set the built agent's file tools receive.
    """
    _write_config(tmp_path)
    project = project_paths("My Project", start=tmp_path)
    sandbox = project.sandbox
    assert sandbox.root == project.base_dir
    assert sandbox.root != project.root
    assert sandbox.workspace_dir == project.base_dir / "workspace"

    perms = build_workspace_permissions(sandbox=sandbox, agent_name=project.slug)

    def _verdict(location: Path, op: Operation) -> ActionVerdict:
        return check_allow_deny_permission(
            location=location,
            op_type=op,
            takes_precedence=perms["takes_precedence"],
            allow_rules=perms["allow_rules"],
            deny_rules=perms["deny_rules"],
            default_verdict=perms["default_verdict"],
            base_path=perms["base"],
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
    _write_config(tmp_path)

    paths = project_paths(name, start=tmp_path)

    assert paths.slug == slug


def test_project_paths_uses_slug_as_project_identity(tmp_path: Path) -> None:
    _write_config(tmp_path)

    mixed_case = project_paths("My Project", start=tmp_path)
    lower_case = project_paths("my project", start=tmp_path)

    assert mixed_case.slug == lower_case.slug
    assert mixed_case.root == lower_case.root


@pytest.mark.parametrize("name", ["", "   ", "東京"])
def test_project_paths_rejects_unsluggable_names(tmp_path: Path, name: str) -> None:
    _write_config(tmp_path)

    with pytest.raises(RuntimeError, match="Project name"):
        project_paths(name, start=tmp_path)


def test_project_paths_derives_project_layout_without_creating_dirs(
    tmp_path: Path,
) -> None:
    _write_config(tmp_path)

    paths = project_paths("My Project", start=tmp_path)
    root = tmp_path / "workspace" / "projects" / "my-project"

    assert paths.root == root
    assert paths.logs == root / "conversation_logs"
    assert paths.snapshots == root / "conversation_snapshots"
    assert paths.memory == root / "persistent_memory"
    assert not root.exists()


def test_manifest_project_creates_only_project_root(tmp_path: Path) -> None:
    _write_config(tmp_path)

    paths = manifest_project("My Project", start=tmp_path)

    assert paths.root == tmp_path / "workspace" / "projects" / "my-project"
    assert paths.root.is_dir()
    assert not paths.logs.exists()
    assert not paths.snapshots.exists()
    assert not paths.memory.exists()
    assert not (paths.root / "code_task_plans").exists()
