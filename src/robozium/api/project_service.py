"""Project operations and activity coordination, independent of HTTP routing."""

import shutil
from collections.abc import Iterator
from contextlib import contextmanager
from threading import RLock

from roboz.runtime.persistence import active_marker_paths, clear_active_markers

from robozium.api.errors import ProjectBusyError
from robozium.api.projects import Project, ProjectListItem, compose_project_list
from robozium.api.run_manager import RunManager
from robozium.api.state import CapabilitySelection
from robozium.hub.application import Hub


class ProjectService:
    def __init__(self, hub: Hub, manager: RunManager) -> None:
        self._hub = hub
        self._manager = manager
        self._lock = RLock()

    def _projects(self) -> list[Project]:
        directory = self._hub.settings.sandbox.projects_dir
        if not directory.is_dir():
            return []
        return [
            self._hub.project(child.name)
            for child in directory.iterdir()
            if child.is_dir()
        ]

    def recover(self) -> None:
        """Discard activity markers left by a previous process before accepting work."""
        sandbox = self._hub.settings.sandbox
        root = sandbox.resolved_root
        allowed = {sandbox.readonly, sandbox.shared, sandbox.projects}
        if root.exists():
            unexpected = sorted(
                child.name
                for child in root.iterdir()
                if child.is_dir() and child.name not in allowed
            )
            if unexpected:
                raise ValueError(
                    f"Unexpected folders in sandbox root {root}: {', '.join(unexpected)}"
                )
        with self._lock:
            for project in self._projects():
                clear_active_markers(project.logs)

    def _existing(self, name: str) -> Project:
        project = self._hub.project(name)
        root = project.root.resolve()
        if root.parent != self._hub.settings.sandbox.projects_dir.resolve():
            raise RuntimeError("invalid project path")
        if not root.is_dir():
            raise FileNotFoundError("unknown project")
        return project

    def _active(self, project: Project) -> bool:
        if self._manager.project_is_busy(project.slug, background_only=True):
            return True
        if not project.logs.is_dir():
            return False
        names = {path.name for path in project.logs.iterdir() if path.is_dir()}
        return bool(active_marker_paths(project.logs, names))

    def configuration_available(self) -> bool:
        """Check both registered workers and persisted background activity."""
        with self._lock:
            return self._manager.configuration_available() and not any(
                self._active(project) for project in self._projects()
            )

    def begin_configuration(self) -> None:
        """Exclude project launches before the environment transaction begins."""
        with self._lock:
            if not self.configuration_available():
                raise ProjectBusyError("Stop all runs and background work before editing environment settings")
            self._manager.begin_configuration()

    def end_configuration(self) -> None:
        self._manager.end_configuration()

    def create(self, name: str) -> str:
        with self._lock:
            project = self._hub.project(name)
            project.root.mkdir(parents=True, exist_ok=False)
            return project.slug

    @contextmanager
    def access(self, name: str) -> Iterator[Project]:
        """Keep an existing project available until the caller finishes its operation."""
        with self._lock:
            yield self._existing(name)

    def prepare_run(
        self, name: str, *, capabilities: CapabilitySelection | None = None
    ) -> str:
        """Check the project and ask the manager to register or reuse a run."""
        with self._lock:
            project = self._existing(name)
            for directory in (
                project.sandbox.readonly_dir,
                project.sandbox.shared_dir,
                project.sandbox.projects_dir,
            ):
                directory.mkdir(parents=True, exist_ok=True)
            return self._manager.create(
                project,
                capabilities=capabilities,
                background_sync_active=self._active(project),
            )

    def list(self) -> list[ProjectListItem]:
        with self._lock:
            projects = self._projects()
            active = {project.slug for project in projects if self._active(project)}
            cancelling = {
                project.slug
                for project in projects
                if self._manager.project_is_cancelling(
                    project.slug, background_sync_active=project.slug in active
                )
            }
            return compose_project_list(
                projects=projects,
                runs=self._manager.list_project_runs(
                    active_background_sync_projects=active
                ),
                cancelling_projects=cancelling,
                active_background_sync_projects=active,
            )

    def delete(self, name: str) -> None:
        with self._lock:
            project = self._existing(name)

            def remove() -> None:
                if self._active(project):
                    raise ProjectBusyError("project has an active run; cancel it first")
                shutil.rmtree(project.root)

            self._manager.delete_project(project.slug, remove)

    def cancel(self, name: str) -> bool:
        with self._lock:
            return self._manager.cancel_runs_for_project(self._existing(name).slug)
