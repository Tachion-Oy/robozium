"""Project-list state composition for the API."""

from __future__ import annotations

from collections.abc import Collection, Iterable
from enum import StrEnum
from typing import TypedDict

from robosprawl.api.state import ProjectRunItem, RunStatus
from robosprawl.workspace import Project


class ProjectStatus(StrEnum):
    RUNNING = "running"
    AWAITING_USER_INPUT = "awaiting_user_input"
    CANCELLING = "cancelling"
    SYNCING = "syncing"
    DORMANT = "dormant"


class ProjectListItem(TypedDict):
    slug: str
    status: ProjectStatus
    run_id: str | None
    current_agent_name: str | None
    created_at: float | None


def _is_live(run: ProjectRunItem) -> bool:
    return run["status"] in {
        RunStatus.QUEUED,
        RunStatus.RUNNING,
        RunStatus.AWAITING_USER_INPUT,
        RunStatus.CANCELLING,
    }


def _live_status(run: ProjectRunItem) -> ProjectStatus:
    if run["status"] == RunStatus.QUEUED:
        # Project rows do not expose a separate queued label; queued is a live
        # orchestrator state and renders under the running bucket.
        return ProjectStatus.RUNNING
    return ProjectStatus(run["status"])


def compose_project_list(
    *,
    projects: Iterable[Project],
    runs: Iterable[ProjectRunItem],
    cancelling_projects: Collection[str] = (),
    active_background_sync_projects: Collection[str] = (),
) -> list[ProjectListItem]:
    live_by_project = {run["project"]: run for run in runs if _is_live(run)}

    slugs = (
        {project.slug for project in projects}
        | set(live_by_project)
        | set(cancelling_projects)
    )

    rows: list[ProjectListItem] = []
    for slug in slugs:
        run = live_by_project.get(slug)
        if run is not None:
            rows.append(
                {
                    "slug": slug,
                    "status": (
                        ProjectStatus.CANCELLING
                        if slug in cancelling_projects
                        else _live_status(run)
                    ),
                    "run_id": run["run_id"],
                    "current_agent_name": run["current_agent_name"],
                    "created_at": run["created_at"],
                }
            )
            continue
        if slug in cancelling_projects:
            status = ProjectStatus.CANCELLING
        elif slug in active_background_sync_projects:
            status = ProjectStatus.SYNCING
        else:
            status = ProjectStatus.DORMANT
        rows.append(
            {
                "slug": slug,
                "status": status,
                "run_id": None,
                "current_agent_name": None,
                "created_at": None,
            }
        )

    return sorted(rows, key=lambda row: row["slug"])


__all__ = ["ProjectListItem", "ProjectStatus", "compose_project_list"]
