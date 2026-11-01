"""Validated environment edits and package copies, independent of HTTP transport."""

import os
import re
import shutil
from collections.abc import Iterable, Mapping, Sequence
from hashlib import sha256
from io import StringIO
from keyword import iskeyword
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import BinaryIO

from dotenv.parser import parse_stream
from roboz.endpoints import (
    ENCRYPTED_SUFFIX,
    decrypt_env_values,
    encrypt_env_values,
    serialize_env,
)

from robozium.api.credentials import LoadedCredentials
from robozium.api.errors import (
    EnvironmentConflictError,
    EnvironmentImportNotFoundError,
    ProjectBusyError,
)
from robozium.api.models import (
    CapabilityView,
    EnvironmentEdit,
    EnvironmentEntry,
    EnvironmentEntryView,
    EnvironmentImport,
    EnvironmentImportResult,
    EnvironmentSuggestion,
    EnvironmentView,
)
from robozium.api.project_service import ProjectService
from robozium.hub import environment as env
from robozium.hub.application import Hub
from robozium.hub.local import CATALOG_FILE, Catalog, inspect_import, read_catalog

_COMMENTED_ASSIGNMENT = re.compile(r"\s*#\s*([A-Za-z_][A-Za-z0-9_]*[ \t]*=.*)")


class EnvironmentService:
    """Own settings persistence and confirmed import labels for one API process.

    Writes share the project service's stopped-run guard. Package files are the
    source of truth; only their discovered labels are retained until restart.
    """

    def __init__(
        self, hub: Hub, projects: ProjectService, credentials: LoadedCredentials
    ) -> None:
        self._hub = hub
        self._projects = projects
        self._credentials = credentials
        self._path = credentials.path
        self._root = hub.settings.config_file.parent.resolve()
        self._destination = self._root / "local" / "imports"
        loaded: dict[str, list[CapabilityView]] = {}
        for package, values in hub.local_packages.capabilities.items():
            if package.is_relative_to(self._destination):
                loaded.setdefault(package.relative_to(self._destination).parts[0], []).extend(
                    CapabilityView.model_validate(value.label) for value in values
                )
        self._imports = {
            name: EnvironmentImport(
                name=name, capabilities=capabilities, variables=[], active=True
            )
            for name, capabilities in loaded.items()
        } | {
            name: EnvironmentImport(name=name, capabilities=[], variables=[], error=error)
            for name, error in hub.local_packages.broken.items()
        }
        # Labels of removed packages stay loaded until restart; re-imports may reuse them.
        self._removed_labels: set[str] = set()

    def read(self) -> EnvironmentView:
        """Return masked settings and examples, without importing or executing code."""
        text = self._read_text(self._path)
        values = self._parse_values(text)
        manual = self._parse_values(self._read_text(self._path.parent / ".env"))
        overrides = {name.removesuffix(ENCRYPTED_SUFFIX) for name in manual}
        entries = self._masked_entries(values, overrides)
        suggestions, imported, errors = self._read_examples()
        return EnvironmentView(
            revision=sha256(text.encode("utf-8")).hexdigest(),
            editable=self._editable(),
            entries=entries,
            overrides=sorted(overrides),
            requires_password=any(entry.secret for entry in entries),
            suggestions=suggestions,
            example_errors=errors,
            imports=imported,
        )

    def save(self, edit: EnvironmentEdit) -> bool:
        """Validate and encrypt a complete replacement, then atomically commit it.

        The save that completes first-start setup also loads the settings into
        this process, since no run has started yet; it returns True. Later saves
        apply after a restart.
        """
        with self._projects.stopped_runs():
            original = self._read_text(self._path)
            if edit.revision != sha256(original.encode("utf-8")).hexdigest():
                raise EnvironmentConflictError(
                    "Settings changed elsewhere. Refresh before saving."
                )
            stored = self._parse_values(original)
            previous = decrypt_env_values(stored, password=edit.password)
            values = self._validated_values(edit.entries, stored, previous)
            encrypted = encrypt_env_values(
                values,
                secret_names={entry.name for entry in edit.entries if entry.secret},
                password=edit.password,
            )
            output = serialize_env(encrypted).encode("utf-8")
            if len(output) > env.MAX_ENV_BYTES:
                raise ValueError("Environment file is too large")
            self._replace_settings(original, output)
            if not self._credentials.setup_required:
                return False
            self._credentials.load(edit.password)
            self._credentials.setup_required = False
            return True

    def replace_file(self, revision: str, content: bytes, password: str | None) -> bool:
        """Adopt a whole saved-settings file, such as one kept from another install.

        The password must open its secrets, so a file that cannot be unlocked is
        never adopted. Like ``save``, completing first-start setup loads it into
        this process and returns True; otherwise it applies after a restart.
        """
        if len(content) > env.MAX_ENV_BYTES:
            raise ValueError("Environment file is too large")
        try:
            text = content.decode("utf-8")
        except UnicodeError:
            raise ValueError("Environment file must be UTF-8") from None
        stored = self._parse_values(text)
        for name in stored:
            base = name.removesuffix(ENCRYPTED_SUFFIX)
            if base in env.CONTROLLED_NAMES:
                raise ValueError("This setting is controlled by the application")
        decrypt_env_values(stored, password=password)
        with self._projects.stopped_runs():
            original = self._read_text(self._path)
            if revision != sha256(original.encode("utf-8")).hexdigest():
                raise EnvironmentConflictError(
                    "Settings changed elsewhere. Refresh before saving."
                )
            self._replace_settings(original, content)
            if not self._credentials.setup_required:
                return False
            self._credentials.load(password)
            self._credentials.setup_required = False
            return True

    def reset(self) -> None:
        """Discard saved settings only while runs and background work are stopped."""
        with self._projects.stopped_runs():
            self._credentials.reset()

    def import_folder(
        self, files: Sequence[tuple[str, BinaryIO]]
    ) -> EnvironmentImportResult:
        """Stage the whole tree and discover real capabilities before publishing the copy."""
        with self._projects.stopped_runs():
            name, paths = self._upload_paths(files)
            destination = self._destination / name
            if destination.exists() or destination.is_symlink():
                raise EnvironmentConflictError(
                    f"An imported folder named {name} already exists"
                )
            if not self._destination.resolve().is_relative_to(self._root / "local"):
                raise ValueError("The import destination must stay inside local/")
            self._destination.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(
                prefix=".upload-", dir=self._destination
            ) as temporary:
                # Reuse the startup loader's imports/<package> layout during validation.
                stage = Path(temporary) / "imports" / name
                self._copy_upload(paths, stage)
                result = self._inspect_package(stage, paths)
                stage.rename(destination)
                self._imports[name] = result.imported
                self._removed_labels.difference_update(
                    cap.name for cap in result.imported.capabilities
                )
            return result

    def remove_import(self, name: str) -> None:
        """Delete an imported package copy; loaded capabilities remain until restart."""
        with self._projects.stopped_runs():
            item = self._imports.get(name)
            if item is None:
                raise EnvironmentImportNotFoundError(f"No imported folder named {name}")
            destination = self._destination / name
            if destination.is_symlink() or not destination.resolve().is_relative_to(
                self._destination.resolve()
            ):
                raise ValueError("The imported folder must stay inside local/imports/")
            if destination.exists():
                shutil.rmtree(destination)
            del self._imports[name]
            if item.active:
                self._removed_labels.update(cap.name for cap in item.capabilities)

    @staticmethod
    def _read_text(path: Path) -> str:
        """Read a bounded UTF-8 file; an absent configuration file is empty."""
        if path.is_symlink():
            raise ValueError(f"Symbolic links are not supported: {path.name}")
        if not path.exists():
            return ""
        if not path.is_file():
            raise ValueError(f"Expected an environment file: {path.name}")
        with path.open("rb") as stream:
            content = stream.read(env.MAX_ENV_BYTES + 1)
        if len(content) > env.MAX_ENV_BYTES:
            raise ValueError(f"Environment file is too large: {path.name}")
        try:
            return content.decode("utf-8")
        except UnicodeError:
            raise ValueError(f"Environment file must be UTF-8: {path.name}") from None

    @staticmethod
    def _parse_values(
        text: str, *, include_comments: bool = False
    ) -> dict[str, str | None]:
        """Parse literal dotenv values, optionally including standalone example comments."""
        values: dict[str, str | None] = {}
        for binding in parse_stream(StringIO(text)):
            if include_comments and binding.key is None and not binding.error:
                optional = _COMMENTED_ASSIGNMENT.fullmatch(
                    binding.original.string.strip()
                )
                if optional:
                    binding = next(parse_stream(StringIO(optional[1])))
            if binding.error or binding.key in values:
                raise ValueError("Invalid or duplicate dotenv assignment")
            if binding.key is not None:
                values[binding.key] = binding.value
        # Reuse RoboZ's name and value validation; do not interpolate or execute values.
        serialize_env(values)
        return values

    @staticmethod
    def _masked_entries(
        values: Mapping[str, str | None], overrides: set[str]
    ) -> list[EnvironmentEntryView]:
        """Expose configuration metadata without exposing encrypted values."""
        entries: dict[str, EnvironmentEntryView] = {}
        for stored_name, value in values.items():
            name = stored_name.removesuffix(ENCRYPTED_SUFFIX)
            if name in entries:
                raise ValueError("Plaintext and encrypted assignments collide")
            secret = stored_name.endswith(ENCRYPTED_SUFFIX)
            entries[name] = EnvironmentEntryView(
                name=name,
                value=None if secret else value,
                secret=secret,
                overridden=name in overrides,
            )
        return list(entries.values())

    def _read_examples(
        self,
    ) -> tuple[list[EnvironmentSuggestion], list[EnvironmentImport], list[str]]:
        """Collect example defaults while reporting unreadable sources individually."""
        errors: list[str] = []
        suggestions: list[EnvironmentSuggestion] = []
        imported: list[EnvironmentImport] = []
        try:
            suggestions = self._example_suggestions(
                self._path.parent / ".env.example", "Application"
            )
        except (OSError, ValueError):
            errors.append("Could not read the application environment example")
        for item in self._imports.copy().values():
            if item.error is not None:
                imported.append(item)
                continue
            try:
                folder = self._destination / item.name
                defaults = self._folder_suggestions(folder, read_catalog(folder))
                suggestions.extend(defaults)
                item = item.model_copy(
                    update={"variables": [entry.name for entry in defaults]}
                )
            except (OSError, ValueError):
                errors.append(f"Could not read environment example for {item.name}")
            imported.append(item)
        return suggestions, imported, errors

    def _example_suggestions(
        self, path: Path, source: str
    ) -> list[EnvironmentSuggestion]:
        values = self._parse_values(self._read_text(path), include_comments=True)
        suggestions = []
        for name, value in values.items():
            if name in env.CONTROLLED_NAMES or name.endswith(ENCRYPTED_SUFFIX):
                continue
            secret = name.upper().endswith(("_API_KEY", "_TOKEN", "_PASSWORD"))
            suggestions.append(
                EnvironmentSuggestion(
                    name=name,
                    value=value or "",
                    secret=secret,
                    source=source,
                )
            )
        return suggestions

    def _editable(self) -> bool:
        try:
            with self._projects.stopped_runs():
                return True
        except ProjectBusyError:
            return False

    @staticmethod
    def _validated_values(
        entries: Sequence[EnvironmentEntry],
        stored: Mapping[str, str | None],
        previous: Mapping[str, str | None],
    ) -> dict[str, str | None]:
        """Resolve omitted values and reject edits that violate environment policy."""
        values: dict[str, str | None] = {}
        for entry in entries:
            if entry.name in values:
                raise ValueError("Variable names must be unique")
            if entry.name in env.CONTROLLED_NAMES:
                raise ValueError("This setting is controlled by the application")
            if (
                entry.value is None
                and not entry.secret
                and entry.name + ENCRYPTED_SUFFIX in stored
            ):
                raise ValueError("Enter a replacement value to make a secret public")
            value = entry.value if entry.value is not None else previous.get(entry.name)
            values[entry.name] = value
        return values

    def _replace_settings(self, original: str, output: bytes) -> None:
        """Commit a private file atomically, rejecting intervening external edits."""
        with TemporaryDirectory(
            prefix=".environment-", dir=self._path.parent
        ) as temporary:
            replacement = Path(temporary) / "settings"
            replacement.touch(mode=0o600)
            with replacement.open("wb") as stream:
                stream.write(output)
                stream.flush()
                os.fsync(stream.fileno())
            if self._read_text(self._path) != original:
                raise EnvironmentConflictError(
                    "Settings changed elsewhere. Refresh before saving."
                )
            os.replace(replacement, self._path)

    @staticmethod
    def _upload_paths(
        files: Sequence[tuple[str, BinaryIO]],
    ) -> tuple[str, dict[PurePosixPath, BinaryIO]]:
        """Validate the entire uploaded file tree before creating any directories."""
        paths: dict[PurePosixPath, BinaryIO] = {}
        for filename, stream in files:
            parts = filename.split("/")
            if (
                len(parts) < 2
                or any(part in ("", ".", "..") for part in parts)
                or any(char in filename for char in ("\\", ":", "\x00"))
            ):
                raise ValueError(
                    "Choose one folder; every file must have a relative path within it"
                )
            path = PurePosixPath(filename)
            if path in paths:
                raise ValueError("The upload contains duplicate file paths")
            paths[path] = stream
        if not paths:
            raise ValueError("Choose a folder containing files")
        name = next(iter(paths)).parts[0]
        if (
            not name.isidentifier()
            or iskeyword(name)
            or any(path.parts[0] != name for path in paths)
        ):
            raise ValueError("Choose one folder with a valid Python package name")
        for path in paths:
            if any(parent in paths for parent in path.parents):
                raise ValueError(
                    "An uploaded path cannot be both a file and a directory"
                )
        return name, {path.relative_to(name): stream for path, stream in paths.items()}

    @staticmethod
    def _copy_upload(paths: Mapping[PurePosixPath, BinaryIO], stage: Path) -> None:
        """Copy the already validated relative paths into the temporary package."""
        for relative, source in paths.items():
            target = stage.joinpath(*relative.parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("xb") as stream:
                shutil.copyfileobj(source, stream)

    def _folder_suggestions(
        self, folder: Path, catalog: Catalog
    ) -> list[EnvironmentSuggestion]:
        """Example settings from every file the folder's catalog lists; the first file to name a variable wins."""
        suggestions: dict[str, EnvironmentSuggestion] = {}
        for path in catalog.env:
            for suggestion in self._example_suggestions(
                folder.joinpath(*path.parts), folder.name
            ):
                suggestions.setdefault(suggestion.name, suggestion)
        return list(suggestions.values())

    def _inspect_package(
        self, folder: Path, uploaded: Iterable[PurePosixPath]
    ) -> EnvironmentImportResult:
        """Confirm the catalog, its packages and unique labels before committing a copy."""
        catalog = read_catalog(folder)
        listed = {PurePosixPath(CATALOG_FILE), *catalog.env}
        for path in uploaded:
            if path not in listed and not any(
                parent in catalog.packages for parent in path.parents
            ):
                raise ValueError(f"{path} is not listed in {CATALOG_FILE}")
        suggestions = self._folder_suggestions(folder, catalog)
        try:
            discovered = inspect_import(self._root, folder, catalog)
        except RuntimeError as exc:
            raise ValueError(str(exc)) from exc
        capabilities = [
            CapabilityView.model_validate(value.label) for value in discovered
        ]
        existing = {label.name for label in self._hub.capabilities()}
        existing -= self._removed_labels
        existing.update(
            cap.name for item in self._imports.values() for cap in item.capabilities
        )
        for capability in capabilities:
            if capability.name in existing:
                raise ValueError(
                    f"A capability named {capability.name!r} already exists; choose a unique label"
                )
        imported = EnvironmentImport(
            name=folder.name,
            capabilities=capabilities,
            variables=[entry.name for entry in suggestions],
        )
        return EnvironmentImportResult(imported=imported, suggestions=suggestions)
