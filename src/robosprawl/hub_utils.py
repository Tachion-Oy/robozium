"""Small shared helpers for hub configuration and project names."""

from __future__ import annotations

import os
import re
import unicodedata
from pathlib import Path

CONFIG_FILE_NAME = "hub.config.json"
LOG_LEVEL_NAMES = frozenset({"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"})


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
    explicit = config_file or (os.environ.get("ROBOSPRAWL_CONFIG") if start is None else None)
    if explicit is not None:
        path = Path(explicit).expanduser().resolve()
        if not path.is_file():
            raise RuntimeError(f"Missing hub config: {path}")
        return path
    current = (start or Path.cwd()).resolve()
    repo_root = Path(__file__).resolve().parents[2]
    for folder in (current, *current.parents, repo_root):
        candidate = folder / CONFIG_FILE_NAME
        if candidate.is_file():
            return candidate
    raise RuntimeError(f"Missing {CONFIG_FILE_NAME}")


def config_relative_name(section: dict[str, object], key: str, label: str) -> str:
    value = section.get(key)
    if not isinstance(value, str) or not value.strip():
        raise RuntimeError(f"Hub config {label}.{key} must be a non-empty string")
    if Path(value).expanduser().is_absolute():
        raise RuntimeError(f"Hub config path must be relative: {label}.{key}")
    return value


def config_log_level(section: dict[str, object], key: str, label: str) -> str:
    value = section.get(key)
    level = value.upper() if isinstance(value, str) else ""
    if level not in LOG_LEVEL_NAMES:
        allowed = ", ".join(sorted(LOG_LEVEL_NAMES))
        raise RuntimeError(f"Hub config {label}.{key} must be one of: {allowed}")
    return level


def config_int(
    section: dict[str, object], key: str, label: str, *, minimum: int
) -> int:
    value = section.get(key)
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise RuntimeError(f"Hub config {label}.{key} must be an integer >= {minimum}")
    return value
