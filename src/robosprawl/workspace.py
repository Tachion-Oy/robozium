"""Three-tier sandboxed workspace layout and its permission policy.

:class:`Sandbox` is the directory structure over a ``root``;
:func:`build_workspace_permissions` turns it into permission rules. Folder names
come from :class:`SandboxNames`. A :class:`Project` is one named location inside a
sandbox (under the projects tier); the shed stays agnostic about which subfolders a
project has - the caller supplies them. See ``docs/reference.md`` for the tier
semantics.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import TypedDict

from roboz_shed.models import ActionVerdict, Operation, PermissionRule


@dataclass(frozen=True)
class SandboxNames:
    """Caller-supplied folder names for a sandbox layout.

    ``safe_scripts`` nests under the read-only tier; the rest are top-level tiers.
    """

    readonly: str
    workspace: str
    projects: str
    safe_scripts: str


class WorkspacePermissions(TypedDict):
    """Permission kwargs accepted by ``get_run_file_command`` / ``get_apply_patch``."""

    base: Path
    allow_rules: list[PermissionRule]
    deny_rules: list[PermissionRule]
    ask_rules: list[PermissionRule]
    takes_precedence: ActionVerdict
    default_verdict: ActionVerdict


@dataclass(frozen=True)
class Sandbox:
    """The sandbox directory layout over ``root`` (structure only, no policy).

    Frozen so it cannot be repointed after being handed to a tool.
    """

    root: Path
    names: SandboxNames

    @property
    def resolved_root(self) -> Path:
        return self.root.resolve()

    @property
    def readonly_dir(self) -> Path:
        return self.resolved_root / self.names.readonly

    @property
    def workspace_dir(self) -> Path:
        return self.resolved_root / self.names.workspace

    @property
    def projects_dir(self) -> Path:
        return self.resolved_root / self.names.projects

    @property
    def scripts_dir(self) -> Path:
        """Where safe shell scripts live: a folder under the read-only tier."""
        return self.readonly_dir / self.names.safe_scripts

    @property
    def allowed_dirnames(self) -> frozenset[str]:
        """Top-level folder names permitted directly under the root."""
        return frozenset(
            {self.names.readonly, self.names.workspace, self.names.projects}
        )

    def project_dir(self, agent_name: str) -> Path:
        """The folder ``agent_name`` may write to without prompting."""
        return self.projects_dir / agent_name

    def validate(self) -> None:
        """Reject unexpected top-level folders directly under the root.

        Only the tier folders (:attr:`allowed_dirnames`) may exist directly under
        the root; a stray folder signals the root is not a clean sandbox. Missing
        tier folders are fine - tools create them at runtime. Files are ignored;
        only directories are checked. A non-existent root is treated as clean.

        Intended to be called once when the hub first opens a workspace root.
        """
        root = self.resolved_root
        if not root.exists():
            return
        unexpected = sorted(
            child.name
            for child in root.iterdir()
            if child.is_dir() and child.name not in self.allowed_dirnames
        )
        if unexpected:
            allowed = ", ".join(sorted(self.allowed_dirnames))
            raise ValueError(
                f"Unexpected folders in workspace root {root}: "
                f"{', '.join(unexpected)}. Only {allowed} are allowed."
            )

    def ensure(self, agent_name: str | None = None) -> None:
        """Create the shared folders (and this agent's project folder) if absent."""
        for directory in (self.readonly_dir, self.workspace_dir, self.projects_dir):
            directory.mkdir(parents=True, exist_ok=True)
        if agent_name is not None:
            self.project_dir(agent_name).mkdir(parents=True, exist_ok=True)


@dataclass(frozen=True)
class Project:
    """A project's folder inside a :class:`Sandbox`, with caller-named subfolders.

    The shed only owns the mechanism: the project lives at
    ``sandbox.project_dir(slug)`` and every entry in ``subdirs`` (a ``name -> folder``
    map the caller supplies, e.g. from config) is reachable as an attribute, so
    ``project.logs`` returns ``root / subdirs["logs"]``. Which subfolders exist is
    the caller's policy, declared once where ``subdirs`` is built - nothing
    folder-specific is baked into the shed. Unknown names raise ``AttributeError``.
    """

    sandbox: Sandbox
    slug: str
    subdirs: Mapping[str, str]

    @property
    def root(self) -> Path:
        """The project's folder; agents write here without prompting."""
        return self.sandbox.project_dir(self.slug)

    @property
    def base_dir(self) -> Path:
        """The sandbox root this project lives in."""
        return self.sandbox.resolved_root

    def __getattr__(self, name: str) -> Path:
        # Only reached for attributes the dataclass/properties don't define, so a
        # configured subfolder name resolves to its path; everything else is a miss.
        subdirs = self.__dict__.get("subdirs")
        if subdirs is not None and name in subdirs:
            return self.root / subdirs[name]
        raise AttributeError(name)


def build_workspace_permissions(
    *, sandbox: Sandbox, agent_name: str
) -> WorkspacePermissions:
    """The three-tier permission rules for ``agent_name`` over ``sandbox``.

    Patterns are relative to ``root`` and ``default_verdict`` is deny, so reads
    and writes stay confined to the sandbox. Do not add absolute patterns - they
    bypass the relative match and break confinement.
    """
    create_delete = {Operation.CREATE, Operation.DELETE}
    workspace_pat = f"{sandbox.names.workspace}/**"
    own_project_pat = f"{sandbox.names.projects}/{agent_name}/**"

    allow_rules = [
        # Read anything inside the sandbox.
        PermissionRule(pattern="**", operations={Operation.READ}),
        # Own project - write freely, no prompt.
        PermissionRule(pattern=own_project_pat, operations=create_delete),
        # Shared workspace - writable, but gated by the ask rule below.
        PermissionRule(pattern=workspace_pat, operations=create_delete),
    ]
    ask_rules = [
        # Every create/delete in the shared workspace prompts the user.
        PermissionRule(pattern=workspace_pat, operations=create_delete),
    ]
    permissions: WorkspacePermissions = {
        "base": sandbox.resolved_root,
        "allow_rules": allow_rules,
        "deny_rules": [],
        "ask_rules": ask_rules,
        "takes_precedence": ActionVerdict.allow,
        "default_verdict": ActionVerdict.deny,  # outside base nothing goes - even reading
    }
    return permissions
