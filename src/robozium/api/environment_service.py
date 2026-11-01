"""Validated environment edits and capability repositories, independent of HTTP transport."""

import os
import re
from collections.abc import Generator, Iterable, Mapping, Sequence
from contextlib import contextmanager
from hashlib import sha256
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

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
    ProjectBusyError,
    RepositoryNotFoundError,
)
from robozium.api.models import (
    CapabilityView,
    EnvironmentEdit,
    EnvironmentEntry,
    EnvironmentEntryView,
    EnvironmentSuggestion,
    EnvironmentView,
    RepositoryAdd,
    RepositoryPackage,
    RepositoryResult,
    RepositoryView,
)
from robozium.api.project_service import ProjectService
from robozium.api.repositories import Repository
from robozium.hub import environment as env
from robozium.hub.application import Hub
from robozium.hub.local import inspect_import

_COMMENTED_ASSIGNMENT = re.compile(r"\s*#\s*([A-Za-z_][A-Za-z0-9_]*[ \t]*=.*)")


class EnvironmentService:
    """Own settings persistence and repository package labels for one API process.

    Writes share the project service's stopped-run guard. A repository's folder
    is the source of truth for its packages; only their labels are kept until restart.
    """

    def __init__(
        self, hub: Hub, projects: ProjectService, credentials: LoadedCredentials
    ) -> None:
        self._hub = hub
        self._projects = projects
        self._credentials = credentials
        self._path = credentials.path
        self._root = hub.settings.config_file.parent.resolve()
        self._repositories = self._root / "local" / "repositories"
        self._packages: dict[str, list[RepositoryPackage]] = {}
        for package, values in hub.local_packages.items():
            if package.parent.parent == self._repositories:
                self._packages.setdefault(package.parent.name, []).append(RepositoryPackage(
                    name=package.name,
                    capabilities=[CapabilityView.model_validate(value.label) for value in values],
                    variables=[],
                    active=True,
                ))
        # Labels of removed packages stay loaded until restart; new packages may reuse them.
        self._removed_labels: set[str] = set()

    def read(self) -> EnvironmentView:
        """Return masked settings and examples, without importing or executing code."""
        text = self._read_text(self._path)
        values = self._parse_values(text)
        manual = self._parse_values(self._read_text(self._path.parent / ".env"))
        overrides = {name.removesuffix(ENCRYPTED_SUFFIX) for name in manual}
        entries = [
            entry for entry in self._masked_entries(values, overrides)
            if not entry.name.startswith(env.REPOSITORY_ENTRIES)
        ]
        suggestions, errors = self._read_examples()
        # A folder whose URL entry is gone still shows, so it can be removed.
        saved = {
            name.removeprefix(env.REPOSITORY_PREFIX).lower(): url
            for name, url in values.items()
            if name.startswith(env.REPOSITORY_PREFIX) and not name.endswith(ENCRYPTED_SUFFIX)
        }
        on_disk = {folder.name for folder in self._repositories.glob("*") if folder.is_dir()}
        repositories = [
            RepositoryView(
                name=key, url=saved.get(key) or "",
                private=self._deploy_key(key) + ENCRYPTED_SUFFIX in values,
                packages=self._with_examples(
                    self._repositories / key, self._packages.get(key, []), suggestions, errors,
                ),
            )
            for key in sorted(saved.keys() | on_disk)
        ]
        return EnvironmentView(
            revision=sha256(text.encode("utf-8")).hexdigest(),
            editable=self._editable(),
            entries=entries,
            overrides=sorted(overrides),
            requires_password=any(entry.secret for entry in entries),
            suggestions=suggestions,
            example_errors=errors,
            repositories=repositories,
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
            secrets = {entry.name for entry in edit.entries if entry.secret}
            # The Repositories section owns these entries; keep them as saved.
            for stored_name in stored:
                name = stored_name.removesuffix(ENCRYPTED_SUFFIX)
                if name.startswith(env.REPOSITORY_ENTRIES):
                    values[name] = previous.get(name)
                    if stored_name != name:
                        secrets.add(name)
            encrypted = encrypt_env_values(values, secret_names=secrets, password=edit.password)
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

    def add_repository(self, request: RepositoryAdd) -> RepositoryResult:
        """Import every package the repository's index lists, then save its URL and key.

        The download happens before runs are paused; only the check and the swap wait.
        A folder left without a saved URL is replaced. A deploy key is encrypted with
        the settings password and loaded at once, so Update can use it without a restart.
        """
        repository = Repository(request.url, request.deploy_key)
        name, url, key = repository.name, repository.url, repository.key
        variable = env.REPOSITORY_PREFIX + name.upper()
        changes = {variable: url}
        self._require_new(variable, name)
        if key:
            # A wrong password fails before anything is fetched.
            decrypt_env_values(self._parse_values(self._read_text(self._path)), password=request.password)
            changes |= encrypt_env_values(
                {self._deploy_key(name): key}, secret_names={self._deploy_key(name)},
                password=request.password,
            )
        with self._staged(repository) as stage, self._projects.stopped_runs():
            self._require_new(variable, name)
            results = self._swap(stage, name)
            try:
                self._write_entries(changes)
            except BaseException:
                self._unswap(stage, name)
                raise
            if key:
                self._credentials.load(request.password)
            return self._record(name, url, results)

    def update_repository(self, name: str) -> RepositoryResult:
        """Replace a repository's packages with what its index lists now, all or none."""
        url = self._repository_url(name)
        key = os.environ.get(self._deploy_key(name))
        stored = self._parse_values(self._read_text(self._path))
        if self._deploy_key(name) + ENCRYPTED_SUFFIX in stored and not key:
            raise ValueError(f"Unlock your settings to update {name}")
        with self._staged(Repository(url, key)) as stage, self._projects.stopped_runs():
            self._repository_url(name)
            return self._record(name, url, self._swap(stage, name))

    def remove_repository(self, name: str) -> None:
        """Delete a repository's folder and its settings entry, whichever exist."""
        variable = env.REPOSITORY_PREFIX + name.upper()
        destination = self._repositories / name
        with self._projects.stopped_runs():
            stored = self._parse_values(self._read_text(self._path))
            if not re.fullmatch(r"[a-z0-9_]+", name) or (
                variable not in stored and not destination.is_dir()
            ):
                raise RepositoryNotFoundError(f"No repository named {name}")
            with TemporaryDirectory(prefix=".staging-", dir=self._root / "local") as temporary:
                removed = Path(temporary) / name
                if destination.is_dir() and not destination.is_symlink():
                    destination.rename(removed)
                try:
                    self._write_entries({
                        variable: None, self._deploy_key(name) + ENCRYPTED_SUFFIX: None,
                    })
                except BaseException:
                    if removed.exists():
                        removed.rename(destination)
                    raise
            self._forget(name)

    @staticmethod
    def _deploy_key(name: str) -> str:
        """The settings entry that keeps a repository's deploy key."""
        return env.DEPLOY_KEY_PREFIX + name.upper()

    def _repository_url(self, name: str) -> str:
        values = self._parse_values(self._read_text(self._path))
        url = values.get(env.REPOSITORY_PREFIX + name.upper())
        if not re.fullmatch(r"[a-z0-9_]+", name) or url is None:
            raise RepositoryNotFoundError(f"No repository named {name}")
        return url

    def _require_new(self, variable: str, name: str) -> None:
        stored = self._parse_values(self._read_text(self._path))
        if variable in stored:
            raise EnvironmentConflictError(
                f"A repository named {name} is already added from {stored[variable]}"
            )

    @contextmanager
    def _staged(self, repository: Repository) -> Generator[Path]:
        """Download the repository's packages into a temporary folder laid out like local/."""
        local = self._root / "local"
        local.mkdir(exist_ok=True)
        with TemporaryDirectory(prefix=".staging-", dir=local) as temporary:
            folder = Path(temporary) / "repositories" / repository.name
            folder.mkdir(parents=True)
            repository.fetch(folder)
            yield Path(temporary)

    def _swap(
        self, stage: Path, name: str
    ) -> list[tuple[RepositoryPackage, list[EnvironmentSuggestion]]]:
        """Check the staged packages, then swap the repository's folder in at once."""
        destination = self._repositories / name
        if destination.is_symlink():
            raise ValueError("The repository folder must stay inside local/repositories/")
        folder = stage / "repositories" / name
        results = self._inspect(stage, name, sorted(folder.iterdir()))
        self._repositories.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            destination.rename(stage / "retired")
        try:
            folder.rename(destination)
        except BaseException:
            self._unswap(stage, name)
            raise
        return results

    def _unswap(self, stage: Path, name: str) -> None:
        """Put back whatever the repository's folder held before ``_swap``."""
        destination, folder = self._repositories / name, stage / "repositories" / name
        if destination.exists() and not folder.exists():
            destination.rename(folder)
        if (stage / "retired").exists():
            (stage / "retired").rename(destination)

    def _record(
        self, name: str, url: str,
        results: Sequence[tuple[RepositoryPackage, list[EnvironmentSuggestion]]],
    ) -> RepositoryResult:
        """Track a committed repository's packages and their labels until restart."""
        self._forget(name)
        self._packages[name] = [package for package, _ in results]
        self._removed_labels.difference_update(
            cap.name for package, _ in results for cap in package.capabilities
        )
        return RepositoryResult(
            repository=RepositoryView(name=name, url=url, packages=self._packages[name]),
            suggestions=[entry for _, suggestions in results for entry in suggestions],
        )

    def _forget(self, name: str) -> None:
        # Labels of loaded packages stay registered until restart.
        for package in self._packages.pop(name, []):
            if package.active:
                self._removed_labels.update(cap.name for cap in package.capabilities)

    def _inspect(
        self, stage: Path, name: str, folders: Sequence[Path]
    ) -> list[tuple[RepositoryPackage, list[EnvironmentSuggestion]]]:
        """Confirm root files and unique labels, ignoring the repository's current packages."""
        for folder in folders:
            if not (folder / "__init__.py").is_file():
                raise ValueError(f"{folder.name} must contain __init__.py at its root")
        suggestions = {
            folder: self._example_suggestions(self._package_example(folder), folder.name)
            for folder in folders
        }
        try:
            discovered = inspect_import(
                self._root, stage, [folder.relative_to(stage) for folder in folders],
                replacing=Path("repositories", name),
            )
        except RuntimeError as exc:
            raise ValueError(str(exc)) from exc
        others = dict(self._packages)
        replaced = others.pop(name, [])
        existing = {label.name for label in self._hub.capabilities()} - self._removed_labels
        existing -= {cap.name for package in replaced for cap in package.capabilities}
        existing.update(
            cap.name for packages in others.values() for package in packages
            for cap in package.capabilities
        )
        results = []
        for folder in folders:
            capabilities = [CapabilityView.model_validate(value.label) for value in discovered[folder]]
            for capability in capabilities:
                if capability.name in existing:
                    raise ValueError(
                        f"A capability named {capability.name!r} already exists; choose a unique label"
                    )
            package = RepositoryPackage(
                name=folder.name, capabilities=capabilities,
                variables=[entry.name for entry in suggestions[folder]],
            )
            results.append((package, suggestions[folder]))
        return results

    def _write_entries(self, changes: Mapping[str, str | None]) -> None:
        """Set or remove stored entries (``None`` removes), keeping every other saved value."""
        original = self._read_text(self._path)
        stored = self._parse_values(original)
        for name, value in changes.items():
            stored.pop(name, None)
            if value is not None:
                stored[name] = value
        output = serialize_env(stored).encode("utf-8")
        if len(output) > env.MAX_ENV_BYTES:
            raise ValueError("Environment file is too large")
        self._replace_settings(original, output)

    @staticmethod
    def _package_example(package: Path) -> Path:
        for name in ("env.example", ".env.example"):
            if (package / name).is_file():
                return package / name
        raise ValueError(f"{package.name} must contain env.example or .env.example at its root")

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

    def _with_examples(
        self, folder: Path, packages: Iterable[RepositoryPackage],
        suggestions: list[EnvironmentSuggestion], errors: list[str],
    ) -> list[RepositoryPackage]:
        """Add each package's example defaults to ``suggestions`` and name them on the package."""
        result = []
        for package in packages:
            try:
                defaults = self._example_suggestions(
                    self._package_example(folder / package.name), package.name
                )
                suggestions.extend(defaults)
                package = package.model_copy(update={"variables": [entry.name for entry in defaults]})
            except (OSError, ValueError):
                errors.append(f"Could not read environment example for {package.name}")
            result.append(package)
        return result

    def _read_examples(self) -> tuple[list[EnvironmentSuggestion], list[str]]:
        """Collect example defaults, reporting an unreadable example instead of failing."""
        try:
            return self._example_suggestions(self._path.parent / ".env.example", "Application"), []
        except (OSError, ValueError):
            return [], ["Could not read the application environment example"]

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
            if entry.name.startswith(env.REPOSITORY_ENTRIES):
                raise ValueError("Add and remove repositories in the Repositories section")
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
