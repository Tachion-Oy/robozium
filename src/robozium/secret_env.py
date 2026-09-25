"""Encrypt dotenv credentials named ``*_SECRET`` for RoboZ runtimes."""

from __future__ import annotations

import argparse
import os
from collections.abc import Mapping
from getpass import getpass
from pathlib import Path
from tempfile import NamedTemporaryFile, TemporaryDirectory
from uuid import uuid4

from dotenv import dotenv_values
from roboz.endpoints import encrypt_env, load_api_keys


def _aliases(names: Mapping[str, str | None]) -> dict[str, str]:
    nonce = uuid4().hex.upper()
    return {
        name: f"ROBOZIUM_SECRET_{nonce}_{index}_API_KEY"
        for index, name in enumerate(names)
        if name.endswith("_SECRET")
    }


def _write_dotenv(path: Path, values: Mapping[str, str | None]) -> None:
    lines = []
    for name, value in values.items():
        if value is None:
            lines.append(f"{name}\n")
        else:
            quoted = value.replace("\\", "\\\\").replace("'", "\\'")
            lines.append(f"{name}='{quoted}'\n")
    path.write_text("".join(lines), encoding="utf-8")
    path.chmod(0o600)


def encrypt_credential_env(path: str | Path = ".env", *, password: str) -> Path:
    """Encrypt ``*_SECRET`` values and legacy API key names into one dotenv file."""
    source = Path(path)
    if source.is_symlink() or not source.is_file():
        raise ValueError("The dotenv path must be an existing regular file")
    values = dotenv_values(source, interpolate=False)
    aliases = _aliases(values)
    encoded = {aliases.get(name, name): value for name, value in values.items()}
    reverse = {alias: name for name, alias in aliases.items()}
    with TemporaryDirectory(prefix="robozium-env-") as directory:
        staged_source = Path(directory) / ".env"
        _write_dotenv(staged_source, encoded)
        encrypted = dotenv_values(
            encrypt_env(staged_source, password=password), interpolate=False
        )
    restored = {reverse.get(name, name): value for name, value in encrypted.items()}
    destination = Path(f"{source}.encrypt")
    with NamedTemporaryFile(dir=source.parent, prefix=f".{destination.name}.", delete=False) as stage:
        staged_destination = Path(stage.name)
    try:
        _write_dotenv(staged_destination, restored)
        os.replace(staged_destination, destination)
    finally:
        staged_destination.unlink(missing_ok=True)
    return destination


def expose_plain_secrets() -> None:
    """Expose plaintext ``*_SECRET`` inputs under their runtime names."""
    for name, value in tuple(os.environ.items()):
        if name.endswith("_SECRET") and value and not value.startswith("roboz:"):
            target = name[: -len("_SECRET")]
            if not os.environ.get(target):
                os.environ[target] = value


def load_credential_env(path: str | Path, *, password: str) -> None:
    """Load encrypted credentials, stripping ``_SECRET`` at runtime."""
    values = dotenv_values(path, interpolate=False)
    pending_secrets = {
        name: value
        for name, value in values.items()
        if name.endswith("_SECRET")
        and value
        and (
            not (present := os.environ.get(name[: -len("_SECRET")]))
            or not present.strip()
            or present.startswith("roboz:")
        )
    }
    aliases = _aliases(pending_secrets)
    encoded = {
        aliases.get(name, name): value
        for name, value in values.items()
        if name.endswith(("_API_KEY", "_SECRET"))
    }
    with TemporaryDirectory(prefix="robozium-env-") as directory:
        staged_source = Path(directory) / ".env.encrypt"
        _write_dotenv(staged_source, encoded)
        try:
            load_api_keys(staged_source, password=password)
            for name, alias in aliases.items():
                target = name[: -len("_SECRET")]
                present = os.environ.get(target)
                if not present or not present.strip() or present.startswith("roboz:"):
                    os.environ[target] = os.environ[alias]
        finally:
            for alias in aliases.values():
                os.environ.pop(alias, None)


def main() -> None:
    parser = argparse.ArgumentParser(description="Encrypt *_SECRET credentials")
    parser.add_argument("command", choices=["encrypt"])
    parser.add_argument("path", nargs="?", default=".env")
    args = parser.parse_args()
    password = os.environ.pop("ROBOZ_ENV_PASSWORD", None)
    if password is None:
        password = getpass("Encryption password: ")
        if password != getpass("Confirm password: "):
            raise ValueError("Passwords do not match")
    output = encrypt_credential_env(args.path, password=password)
    print(f"Encrypted credentials: {output}")


if __name__ == "__main__":
    main()
