"""Hub configuration discovery, loading, and project-name normalization."""

from __future__ import annotations

import os
import re
import runpy
import unicodedata
from dataclasses import replace
from pathlib import Path
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from robosprawl.hub.application import Hub


def slugify_project_name(name: str) -> str:
    normalized = unicodedata.normalize("NFKD", name.strip())
    ascii_name = normalized.encode("ascii", "ignore").decode("ascii")
    dashed = re.sub(r"[\s_]+", "-", ascii_name.lower())
    safe = re.sub(r"[^a-z0-9-]", "", dashed)
    slug = re.sub(r"-+", "-", safe).strip("-")
    if not slug:
        raise RuntimeError("Project name must contain slug-safe characters")
    return slug


def find_hub_config(start: Path | None, *, config_file: Path | None = None) -> Path:
    """Select an explicit file or find Python configuration in parent directories."""
    explicit = config_file or (
        os.environ.get("ROBOSPRAWL_CONFIG") if start is None else None
    )
    if explicit is not None:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f"Missing hub config: {path}")
        return path
    current = (start or Path.cwd()).resolve()
    for folder in (current, *current.parents):
        candidate = folder / "hub.config.py"
        if candidate.is_file():
            return candidate
    raise RuntimeError("Missing hub.config.py")


def load_hub(*, start: Path | None = None, config_file: Path | None = None) -> Hub:
    """Load configuration constants and anchor paths without starting the host."""
    from robosprawl.hub.application import Hub, HubValues

    path = find_hub_config(start, config_file=config_file)
    try:
        if path.suffix != ".py":
            raise ValueError("hub configuration must be a Python file")
        values = cast(HubValues, runpy.run_path(str(path)))
        missing = HubValues.__required_keys__ - values.keys()
        if missing:
            raise ValueError(
                f"Missing configuration choices: {', '.join(sorted(missing))}"
            )
        workspace = values["WORKSPACE"]
        logging = values["LOGGING"]
        return Hub(
            name=values["NAME"],
            workspace=replace(workspace, root=(path.parent / workspace.root).resolve()),
            logs_dir=values["LOGS_DIR"],
            snapshots_dir=values["SNAPSHOTS_DIR"],
            memory_dir=values["MEMORY_DIR"],
            logging=replace(logging, path=(path.parent / logging.path).resolve()),
            dependency_health=values["DEPENDENCY_HEALTH"],
            models=values["MODELS"],
            default_model=values["DEFAULT_MODEL"],
            deployment=values["DEPLOYMENT"],
            transcription_endpoint=values["TRANSCRIPTION_ENDPOINT"],
            dependency_registry=values["DEPENDENCY_REGISTRY"],
        )
    except Exception as exc:
        raise RuntimeError(f"Invalid hub config {path}: {exc}") from exc
