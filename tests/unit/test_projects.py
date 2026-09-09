from pathlib import Path

import pytest
from roboshed.sandbox import Sandbox

from robosprawl.api.projects import Project, ProjectStatus, compose_project_list
from robosprawl.api.state import ProjectRunItem, RunStatus


def _project(tmp_path: Path, slug: str = "alpha") -> Project:
    return Project(
        sandbox=Sandbox(
            root=tmp_path,
            shared="workspace",
            logs=Path("conversation_logs"),
        ),
        slug=slug,
    )


def _run(
    project: str,
    *,
    status: RunStatus,
    created_at: float = 1.0,
) -> ProjectRunItem:
    return {
        "run_id": f"run-{project}",
        "project": project,
        "status": status,
        "created_at": created_at,
        "current_agent_name": "orchestrator",
    }


def _write_snapshot_memory_artifacts(project: Project) -> None:
    (project.memory / "memory.md").parent.mkdir(parents=True, exist_ok=True)
    (project.memory / "memory.md").write_text("old memory", encoding="utf-8")
    (project.snapshots / "conv-1" / "snapshot.md").parent.mkdir(
        parents=True, exist_ok=True
    )
    (project.snapshots / "conv-1" / "snapshot.md").write_text(
        "# Conversation Snapshot: orchestrator\n\nnew",
        encoding="utf-8",
    )


def test_compose_project_list_orders_rows_by_slug_not_live_status(
    tmp_path: Path,
) -> None:
    alpha = _project(tmp_path, "alpha")
    zeta = _project(tmp_path, "zeta")

    rows = compose_project_list(
        projects=[alpha, zeta],
        runs=[_run("zeta", status=RunStatus.AWAITING_USER_INPUT, created_at=100.0)],
    )

    assert [row["slug"] for row in rows] == ["alpha", "zeta"]


def test_compose_project_list_live_status_wins_over_disk_artifacts(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    _write_snapshot_memory_artifacts(project)
    run = _run(project.slug, status=RunStatus.CANCELLING, created_at=123.0)

    rows = compose_project_list(
        projects=[project],
        runs=[run],
        active_background_sync_projects={project.slug},
    )

    assert rows == [
        {
            "slug": project.slug,
            "status": ProjectStatus.CANCELLING,
            "run_id": f"run-{project.slug}",
            "current_agent_name": "orchestrator",
            "created_at": 123.0,
        }
    ]


@pytest.mark.parametrize(
    ("run_status", "expected_status"),
    [
        (RunStatus.QUEUED, ProjectStatus.RUNNING),
        (RunStatus.RUNNING, ProjectStatus.RUNNING),
        (RunStatus.AWAITING_USER_INPUT, ProjectStatus.AWAITING_USER_INPUT),
        (RunStatus.CANCELLING, ProjectStatus.CANCELLING),
    ],
)
def test_compose_project_list_live_status_wins_over_running_librarian(
    tmp_path: Path,
    run_status: RunStatus,
    expected_status: ProjectStatus,
) -> None:
    project = _project(tmp_path)
    run = _run(project.slug, status=run_status, created_at=123.0)

    rows = compose_project_list(
        projects=[project],
        runs=[run],
        active_background_sync_projects={project.slug},
    )

    assert rows == [
        {
            "slug": project.slug,
            "status": expected_status,
            "run_id": f"run-{project.slug}",
            "current_agent_name": "orchestrator",
            "created_at": 123.0,
        }
    ]


def test_compose_project_list_terminal_runs_do_not_render_live_row(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    _write_snapshot_memory_artifacts(project)
    run = _run(project.slug, status=RunStatus.COMPLETED, created_at=123.0)

    rows = compose_project_list(projects=[project], runs=[run])

    assert rows == [
        {
            "slug": project.slug,
            "status": ProjectStatus.DORMANT,
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_compose_project_list_orphan_running_librarian_reports_syncing(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)

    rows = compose_project_list(
        projects=[project],
        runs=[],
        active_background_sync_projects={project.slug},
    )

    assert rows == [
        {
            "slug": project.slug,
            "status": ProjectStatus.SYNCING,
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_compose_project_list_explicit_cancellation_overrides_running_librarian(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)

    rows = compose_project_list(
        projects=[project],
        runs=[
            _run(
                project.slug,
                status=RunStatus.CANCELLED,
                created_at=123.0,
            )
        ],
        cancelling_projects={project.slug},
        active_background_sync_projects={project.slug},
    )

    assert rows[0]["status"] == ProjectStatus.CANCELLING


def test_compose_project_list_run_history_does_not_control_project_lifecycle(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)

    rows = compose_project_list(
        projects=[project],
        runs=[
            _run(
                project.slug,
                status=RunStatus.CANCELLED,
                created_at=100.0,
            ),
            _run(
                project.slug,
                status=RunStatus.COMPLETED,
                created_at=200.0,
            ),
        ],
        active_background_sync_projects={project.slug},
    )

    assert rows[0]["status"] == ProjectStatus.SYNCING


def test_compose_project_list_orphan_terminal_librarian_reports_dormant(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)

    rows = compose_project_list(projects=[project], runs=[])

    assert rows == [
        {
            "slug": project.slug,
            "status": ProjectStatus.DORMANT,
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_compose_project_list_ignores_non_liveness_disk_artifacts(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    _write_snapshot_memory_artifacts(project)

    rows = compose_project_list(projects=[project], runs=[])

    assert rows == [
        {
            "slug": project.slug,
            "status": ProjectStatus.DORMANT,
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]


def test_compose_project_list_does_not_inspect_conversation_history(
    tmp_path: Path,
) -> None:
    project = _project(tmp_path)
    torn = project.logs / "librarian" / "conv-1.json"
    torn.parent.mkdir(parents=True, exist_ok=True)
    torn.write_text("{not-json", encoding="utf-8")

    rows = compose_project_list(projects=[project], runs=[])

    assert rows == [
        {
            "slug": project.slug,
            "status": ProjectStatus.DORMANT,
            "run_id": None,
            "current_agent_name": None,
            "created_at": None,
        }
    ]
