"""Robozium project-agent application. Importing it performs no startup."""

from enum import StrEnum

RUNTIME_MODE_ENV_VAR = "ROBOZIUM_MODE"


class RuntimeMode(StrEnum):
    LIVE = "live"
    MOCK = "mock"
