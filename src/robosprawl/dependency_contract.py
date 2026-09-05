"""Bind the deployed dependency graph to the Hub's exact registrations."""

from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from roboz.tooling import (
    ExternalDependency,
    ExternalDependencyKind,
)
from roboz.tooling.dependencies import dedupe_external_dependencies

DependencyChecker = Callable[[ExternalDependency], Any]


class DependencyContractError(RuntimeError):
    """The deployed dependency graph and Hub registrations disagree."""


@dataclass(frozen=True)
class DependencyRegistration:
    """One exact dependency approved by the deployment and its safe checker."""

    dependency_id: str
    kind: ExternalDependencyKind
    check: DependencyChecker


@dataclass(frozen=True)
class BoundDependency:
    """A discovered dependency paired with its validated checker."""

    dependency: ExternalDependency
    check: DependencyChecker


def bind_dependencies(
    discovered: Iterable[ExternalDependency],
    registrations: Sequence[DependencyRegistration],
) -> tuple[BoundDependency, ...]:
    """Require exact ID/kind equality and bind each dependency to its checker."""

    registered = {item.dependency_id: item for item in registrations}
    if len(registered) != len(registrations):
        raise DependencyContractError("duplicate dependency registration")

    dependencies = {
        item.dependency_id: item for item in dedupe_external_dependencies(discovered)
    }

    discovered_kinds = {key: item.kind for key, item in dependencies.items()}
    registered_kinds = {key: item.kind for key, item in registered.items()}
    if discovered_kinds != registered_kinds:
        raise DependencyContractError(
            "dependency contract mismatch: "
            f"discovered={discovered_kinds}, registered={registered_kinds}"
        )

    return tuple(
        BoundDependency(
            dependency=dependency,
            check=registered[dependency.dependency_id].check,
        )
        for dependency in dependencies.values()
    )
