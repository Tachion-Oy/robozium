"""Logging configuration defaults, independent of agent deployment choices."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal


@dataclass(frozen=True)
class HubLoggingConfig:
    """Explicit logging policy; constructing it installs no handlers."""

    console_level: str = "INFO"
    path: Path = Path(".runtime/logs/backend.jsonl")
    file_level: str = "DEBUG"
    max_bytes: int = 26214400
    backup_count: int = 5
    on_error: Literal["fail", "console"] = "fail"

    def __post_init__(self) -> None:
        for key in ("console_level", "file_level"):
            level = getattr(self, key).upper()
            if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
                raise ValueError(f"unknown logging {key}: {level}")
            object.__setattr__(self, key, level)
        for key, minimum in (("max_bytes", 1), ("backup_count", 0)):
            value = getattr(self, key)
            if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
                raise ValueError(f"logging {key} must be an integer >= {minimum}")
        if self.on_error not in {"fail", "console"}:
            raise ValueError("logging on_error must be fail or console")
