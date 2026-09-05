from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from robosprawl.hub_utils import (
    config_int,
    config_log_level,
    config_relative_name,
    find_hub_config,
    slugify_project_name,
)
from robosprawl.workspace import Project, Sandbox, SandboxNames


@dataclass(frozen=True)
class HubLoggingConfig:
    console_level: str
    path: Path
    file_level: str
    max_bytes: int
    backup_count: int
    on_error: Literal["fail", "console"]

    @classmethod
    def from_config(
        cls,
        data: object,
        *,
        config_file: Path,
        projects_dir: Path,
    ) -> HubLoggingConfig:
        if not isinstance(data, dict):
            raise RuntimeError("Hub config 'logging' must be an object")
        console = data.get("console")
        file = data.get("file")
        if not isinstance(console, dict) or not isinstance(file, dict):
            raise RuntimeError(
                "Hub config logging.console and logging.file must be objects"
            )

        configured_path = config_relative_name(file, "path", "logging.file")
        file_path = (config_file.parent / configured_path).resolve()
        resolved_projects = projects_dir.resolve()
        if file_path == resolved_projects or file_path.is_relative_to(
            resolved_projects
        ):
            raise RuntimeError("Hub config logging.file.path must be outside projects")

        on_error = file.get("on_error")
        if on_error not in {"fail", "console"}:
            raise RuntimeError(
                "Hub config logging.file.on_error must be 'fail' or 'console'"
            )

        return cls(
            console_level=config_log_level(console, "level", "logging.console"),
            path=file_path,
            file_level=config_log_level(file, "level", "logging.file"),
            max_bytes=config_int(file, "max_bytes", "logging.file", minimum=1),
            backup_count=config_int(file, "backup_count", "logging.file", minimum=0),
            on_error=on_error,
        )


@dataclass(frozen=True)
class HubConfig:
    """A parsed ``hub.config.json``: just names and a root.

    ``sandbox`` is the workspace root plus its tier folder names; ``project_subdirs``
    is the ``name -> folder`` map each project gets (this is where the hub declares
    which subfolders a project owns). Both come straight from the config. Call
    :meth:`project` to turn a project name into a :class:`Project`.
    """

    name: str
    sandbox: Sandbox
    project_subdirs: Mapping[str, str]
    logging: HubLoggingConfig

    def project(self, name: str) -> Project:
        return Project(
            sandbox=self.sandbox,
            slug=slugify_project_name(name),
            subdirs=self.project_subdirs,
        )

    def manifest_project(self, name: str) -> Project:
        project = self.project(name)
        project.root.mkdir(parents=True, exist_ok=True)
        return project


def transcription_endpoint() -> None:
    """Live transcription is deferred in this port."""
    return None


def load_hub_config(*, start: Path | None = None) -> HubConfig:
    config_file = find_hub_config(start)
    try:
        data = json.loads(config_file.read_text(encoding="utf-8"))
        name = data["hub"]["name"]
        sandbox_cfg = data["sandbox"]
        project_cfg = data["project"]
        logging_cfg = data["logging"]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise RuntimeError(f"Invalid hub config: {config_file}") from exc
    if not isinstance(name, str) or not name.strip():
        raise RuntimeError("Hub config hub.name must be a non-empty string")
    if not isinstance(sandbox_cfg, dict) or not isinstance(project_cfg, dict):
        raise RuntimeError("Hub config 'sandbox' and 'project' must be objects")
    root = (
        config_file.parent / config_relative_name(sandbox_cfg, "root", "sandbox")
    ).resolve()
    sandbox = Sandbox(
        root=root,
        names=SandboxNames(
            readonly=config_relative_name(sandbox_cfg, "readonly", "sandbox"),
            workspace=config_relative_name(sandbox_cfg, "workspace", "sandbox"),
            projects=config_relative_name(sandbox_cfg, "projects", "sandbox"),
            safe_scripts=config_relative_name(sandbox_cfg, "safe_scripts", "sandbox"),
        ),
    )
    # Every entry under "project" becomes a project subfolder, so a new folder is just
    # a config line - reachable as project.<key> with no code change.
    project_subdirs = {
        key: config_relative_name(project_cfg, key, "project") for key in project_cfg
    }
    return HubConfig(
        name=name,
        sandbox=sandbox,
        project_subdirs=project_subdirs,
        logging=HubLoggingConfig.from_config(
            logging_cfg,
            config_file=config_file,
            projects_dir=sandbox.projects_dir,
        ),
    )


def hub_paths(*, start: Path | None = None) -> Sandbox:
    """The hub's workspace sandbox: its root and tier folders."""
    return load_hub_config(start=start).sandbox


def project_paths(name: str, *, start: Path | None = None) -> Project:
    return load_hub_config(start=start).project(name)


def manifest_project(name: str, *, start: Path | None = None) -> Project:
    """Create the durable project root and return its derived paths."""
    return load_hub_config(start=start).manifest_project(name)


__all__ = [
    "HubConfig",
    "HubLoggingConfig",
    "hub_paths",
    "load_hub_config",
    "manifest_project",
    "project_paths",
    "transcription_endpoint",
]
