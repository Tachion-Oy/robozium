"""Project operations and activity coordination, independent of HTTP routing."""

import shutil
from threading import RLock

from roboz.runtime.persistence import active_marker_paths, clear_active_markers

from robosprawl.api.errors import ProjectBusyError
from robosprawl.api.projects import ProjectListItem, compose_project_list
from robosprawl.api.run_manager import RunManager
from robosprawl.hub import HubConfig
from robosprawl.workspace import Project


class ProjectService:
    def __init__(self, config: HubConfig, manager: RunManager) -> None:
        self._config = config
        self._manager = manager
        self._lock = RLock()

    def _projects(self) -> list[Project]:
        directory = self._config.sandbox.projects_dir
        if not directory.is_dir():
            return []
        return [
            self._config.project(child.name)
            for child in directory.iterdir()
            if child.is_dir()
        ]

    def recover(self) -> None:
        """Discard activity markers left by a previous process before accepting work."""
        self._config.sandbox.validate()
        with self._lock:
            for project in self._projects():
                clear_active_markers(project.logs)

    def _existing(self, name: str) -> Project:
        project = self._config.project(name)
        root = project.root.resolve()
        if root.parent != self._config.sandbox.projects_dir.resolve():
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

    def create(self, name: str) -> str:
        with self._lock:
            return self._config.manifest_project(name).slug

    def prepare_run(self, name: str) -> str:
        """Check the project and ask the manager to register or reuse a run."""
        with self._lock:
            project = self._existing(name)
            return self._manager.create(
                project, background_sync_active=self._active(project)
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
