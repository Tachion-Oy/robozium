"""Robozium project-agent application. Importing it performs no startup."""

from enum import StrEnum


class RuntimeMode(StrEnum):
    LIVE = "live"
    MOCK = "mock"
