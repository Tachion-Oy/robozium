"""Discover dotenv examples and prepare encrypted root configuration changes."""

import hashlib
import os
import re
import tempfile
from io import StringIO
from pathlib import Path
from threading import RLock
from uuid import uuid4

from dotenv.parser import parse_stream
from pydantic import BaseModel, ConfigDict, Field
from roboz.endpoints import (
    ENCRYPTED_SUFFIX,
    decrypt_env_values,
    encrypt_env_values,
    serialize_env,
)

MAX_BYTES = 262144
STARTUP_NAMES = frozenset({
    "ROBOZIUM_LOCAL_DIRS", "ROBOZIUM_HUB_ROOT", "ROBOZIUM_WEB_PORT",
    "ROBOZIUM_API_USER", "COMPOSE_PROJECT_NAME",
})
CONTROLLED_NAMES = frozenset({
    "ROBOZIUM_MODE", "ROBOZIUM_CONFIG", "ROBOZIUM_ENV_ROOT", "ROBOZIUM_ENV_CONTROL",
    "ROBOZIUM_ENCRYPTED_ENV_PATH", "ROBOZIUM_HOST_SCRIPT_SOCKET", "ROBOZIUM_LOG_DIR",
    "ROBOZIUM_HOST_HUB_DIR", "ROBOZIUM_HOST_LOG_DIR", "ROBOZIUM_HOST_SOCKET_DIR",
    "ROBOZIUM_BOOT_ERROR", "ROBOZ_ENV_PASSWORD", "ROBOZIUM_LAUNCHER_WEB_PORT", "COMPOSE_PROJECT_NAME", "ROBOZIUM_API_USER",
})


class EnvironmentConflict(ValueError):
    """The user edited an obsolete configuration revision."""


class EnvironmentRow(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=256)
    value: str | None = Field(default=None, max_length=65536)
    secret: bool = False


class EnvironmentEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: str
    entries: list[EnvironmentRow] = Field(max_length=256)
    password: str | None = Field(default=None, max_length=1024, repr=False)


def atomic_write(path: Path, text: str) -> None:
    """Replace a regular file using an owner-only temporary in its directory."""
    if path.is_symlink():
        raise ValueError("Configuration files must not be symbolic links")
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def parse_values(text: str) -> dict[str, str | None]:
    """Parse literal assignments, rejecting ambiguous or malformed documents."""
    values: dict[str, str | None] = {}
    for binding in parse_stream(StringIO(text)):
        if binding.error or binding.key in values:
            raise ValueError("Invalid or duplicate dotenv assignment")
        if binding.key is not None:
            values[binding.key] = binding.value
    serialize_env(values)  # Validate names and NUL characters without interpolation.
    return values


def read_text(path: Path) -> str:
    if not path.exists():
        return ""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError("Configuration must be a regular file smaller than 256 KiB")
    return path.read_text(encoding="utf-8")


def suggested_secret(name: str) -> bool:
    return name.upper().endswith(("_API_KEY", "_PASSWORD", "_TOKEN"))


def stored_name(name: str) -> str:
    return name.removesuffix(ENCRYPTED_SUFFIX)


def load_root_environment() -> None:
    """Restore literal root values after Compose has populated the API environment.

    Compose and python-dotenv handle quoted backslashes differently. Read the
    mounted source with the same parser used by the editor, preserving the
    application-controlled container paths and the manual .env override.
    Native processes retain their existing environment-loading behavior.
    """
    configured_root = os.environ.get("ROBOZIUM_ENV_ROOT")
    if not configured_root or not os.environ.get("ROBOZIUM_ENV_CONTROL"):
        return
    root = Path(configured_root)
    values = parse_values(read_text(root / ".env.encrypt"))
    values.update(parse_values(read_text(root / ".env")))
    os.environ.update({
        name: value for name, value in values.items()
        if stored_name(name) not in CONTROLLED_NAMES
        and stored_name(name) not in {"ROBOZIUM_HUB_ROOT", "ROBOZIUM_LOCAL_DIRS", "ROBOZIUM_WEB_PORT"}
        and value is not None
    })


class EnvironmentStore:
    """Own one root file, with host writes delegated when running in Docker."""

    def __init__(self, root: Path, *, control: Path | None = None) -> None:
        self.root = root
        self.control = control
        self.lock = RLock()
        self.generation = str(uuid4())
        self.boot_error = os.environ.get("ROBOZIUM_BOOT_ERROR", "")

    def documents(self) -> tuple[str, dict[str, str | None], dict[str, str | None]]:
        text = read_text(self.root / ".env.encrypt")
        saved = parse_values(text)
        overrides = parse_values(read_text(self.root / ".env"))
        normalized = [stored_name(name) for name in saved]
        if len(normalized) != len(set(normalized)):
            raise ValueError("Plaintext and encrypted assignments collide")
        return hashlib.sha256(text.encode()).hexdigest(), saved, overrides

    def operation(self) -> str:
        if self.control is None:
            return "idle"
        status = self.control / "status"
        return read_text(status).strip() or "idle"

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            revision, values, overrides = self.documents()
            entries = []
            for name, value in values.items():
                base = stored_name(name)
                secret = name.endswith(ENCRYPTED_SUFFIX)
                entries.append({
                    "name": base, "value": None if secret else value,
                    "secret": secret, "configured": True, "overridden": base in overrides,
                    "startup": base in STARTUP_NAMES,
                })
            return {
                "revision": revision, "entries": entries,
                "overrides": sorted(stored_name(name) for name in overrides),
                "requires_password": any(name.endswith(ENCRYPTED_SUFFIX) for name in values),
                "restart_available": self.control is not None,
                "operation": self.operation(), "generation": self.generation,
                "boot_error": self.boot_error,
            }

    def suggestions(self) -> tuple[list[dict[str, object]], list[str]]:
        roots = [(self.root, "Application", False), (self.root / "local", "Local", True)]
        for index, raw in enumerate(os.environ.get("ROBOZIUM_LOCAL_DIRS", "").split(";")):
            if raw.strip():
                roots.append(((self.root / raw.strip()).resolve(), f"Catalogue {index + 1}", True))
        results: list[dict[str, object]] = []
        errors: list[str] = []
        for root, label, packages in roots:
            paths = [root / ".env.example"]
            if packages:
                paths.extend(sorted(root.glob("tools/*/.env.example")))
                paths.extend(sorted(root.glob("skills/*/.env.example")))
            for path in paths:
                if not path.exists():
                    continue
                source = f"{label}/{path.relative_to(root)}"
                try:
                    if not path.resolve().is_relative_to(root.resolve()):
                        raise ValueError("Example escapes its catalogue")
                    text = re.sub(r"(?m)^\s*#\s*(?=[A-Za-z_][A-Za-z0-9_]*\s*=)", "", read_text(path))
                    for name, value in parse_values(text).items():
                        if name in CONTROLLED_NAMES or name.endswith(ENCRYPTED_SUFFIX):
                            continue
                        results.append({"name": name, "value": value or "", "source": source,
                                        "secret": suggested_secret(name) and name not in STARTUP_NAMES})
                except (OSError, UnicodeError, ValueError):
                    errors.append(f"Could not read {source}")
        return results, errors

    def prepare(self, edit: EnvironmentEdit) -> str:
        revision, saved, _ = self.documents()
        if edit.revision != revision:
            raise EnvironmentConflict("Settings changed elsewhere. Refresh before saving.")
        names = [row.name for row in edit.entries]
        if len(set(names)) != len(names):
            raise ValueError("Each environment variable must have a unique name")
        for row in edit.entries:
            if row.name in CONTROLLED_NAMES:
                raise ValueError("This setting is controlled by the application")
            if row.name == "ROBOZIUM_WEB_PORT" and (row.value is None or not row.value.isdecimal() or not 1 <= int(row.value) <= 65535):
                raise ValueError("Web port must be an integer between 1 and 65535")
            if row.secret and row.name in STARTUP_NAMES:
                raise ValueError("Startup settings must remain unencrypted")
        # Verify all existing ciphertext before replacing or deleting any of it.
        previous = decrypt_env_values(saved, password=edit.password)
        plain: dict[str, str | None] = {}
        secrets: set[str] = set()
        for row in edit.entries:
            value = row.value if row.value is not None else previous.get(row.name)
            if value is None:
                raise ValueError("Supply a value for each new variable")
            plain[row.name] = value
            if row.secret:
                secrets.add(row.name)
        encrypted = encrypt_env_values(plain, secret_names=secrets, password=edit.password)
        # Stable ciphertext makes reviews and revision checks useful.
        for row in edit.entries:
            name = row.name + ENCRYPTED_SUFFIX
            if row.secret and row.value is None and name in saved:
                encrypted[name] = saved[name]
        text = serialize_env(encrypted)
        if len(text.encode()) > MAX_BYTES:
            raise ValueError("Environment file is too large")
        return text

    def save(self, edit: EnvironmentEdit) -> None:
        with self.lock:
            text = self.prepare(edit)
            if self.control is None:
                atomic_write(self.root / ".env.encrypt", text)
                return
            if self.operation() in {"pending", "applying"}:
                raise EnvironmentConflict("An environment update is already in progress")
            self.control.mkdir(parents=True, exist_ok=True)
            atomic_write(self.control / "expected", read_text(self.root / ".env.encrypt"))
            atomic_write(self.control / "candidate", text)
            atomic_write(self.control / "status", "pending")
            atomic_write(self.control / "request", "apply")
