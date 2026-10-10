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
    from robozium.hub.application import Hub, HubSettings


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
        os.environ.get("ROBOZIUM_CONFIG") if start is None else None
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


def load_hub_settings(
    *, start: Path | None = None, config_file: Path | None = None
) -> HubSettings:
    """Read configuration and anchor paths without loading private packages."""
    from robozium.hub.application import HubSettings, HubValues

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
        sandbox = values["SANDBOX"]
        logging = values["LOGGING"]
        return HubSettings(
            config_file=path,
            name=values["NAME"],
            sandbox=replace(sandbox, root=(path.parent / sandbox.root).resolve()),
            logging=replace(logging, path=(path.parent / logging.path).resolve()),
            dependency_health=values["DEPENDENCY_HEALTH"],
            models=values["MODELS"],
            default_model=values["DEFAULT_MODEL"],
            memory_endpoint=values["MEMORY_ENDPOINT"],
            subagents=values["SUBAGENTS"],
            transcription_endpoint=values["TRANSCRIPTION_ENDPOINT"],
            additional_dependencies=values["ADDITIONAL_DEPENDENCIES"],
        )
    except Exception as exc:
        raise RuntimeError(f"Invalid hub config {path}: {exc}") from exc


def load_hub(*, start: Path | None = None, config_file: Path | None = None) -> Hub:
    """Validate settings and load private capabilities without starting agents."""
    from robozium.hub.application import Hub

    settings = load_hub_settings(start=start, config_file=config_file)
    try:
        return Hub(settings)
    except Exception as exc:
        raise RuntimeError(f"Invalid hub config {settings.config_file}: {exc}") from exc
