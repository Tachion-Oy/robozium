"""Discover private capability packages in the application's local directory."""

import json
import subprocess
import sys
from collections.abc import Callable
from contextlib import ExitStack
from dataclasses import dataclass
from functools import cache
from hashlib import sha256
from importlib import import_module, invalidate_caches
from importlib.machinery import ModuleSpec
from importlib.metadata import distributions
from keyword import iskeyword
from pathlib import Path, PurePosixPath
from shutil import which
from sysconfig import get_platform
from tempfile import TemporaryDirectory
from threading import RLock
from types import ModuleType
from typing import Literal, cast
from uuid import uuid4

from roboz.deployment import Capability

_IMPORT_LOCK = RLock()
_LOCAL_PACKAGE_PREFIX = "_robozium_local_"
CATALOG_FILE = "robozium.json"

type Kind = Literal["tool", "skill"]
_CATALOG_KEYS: dict[str, Kind] = {"tools": "tool", "skills": "skill"}
# Only example files: a listed .env would copy real credentials into the import.
_ENV_EXAMPLE_NAMES = ("env.example", ".env.example")


@dataclass(frozen=True)
class Catalog:
    """What an imported folder declares: packages by kind and example settings files."""

    packages: dict[PurePosixPath, Kind]
    env: tuple[PurePosixPath, ...]


def read_catalog(folder: Path) -> Catalog:
    """Read and check the folder's robozium.json and its example files.

    Listed packages are checked only when loaded, so a broken package never
    hides the folder's example settings. Nothing in the folder is executed.
    """
    file = folder / CATALOG_FILE
    if file.is_symlink() or not file.is_file():
        raise ValueError(f"{folder.name}: {CATALOG_FILE} is missing at the folder root")
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except (UnicodeError, ValueError):
        raise ValueError(f"{folder.name}: {CATALOG_FILE} is not valid JSON") from None
    if not isinstance(data, dict) or not set(data) <= {*_CATALOG_KEYS, "env"}:
        raise ValueError(
            f'{folder.name}: {CATALOG_FILE} must be an object with only "tools", "skills" and "env"'
        )
    root = folder.resolve()
    packages: dict[PurePosixPath, Kind] = {}
    for key, kind in _CATALOG_KEYS.items():
        for path in _catalog_paths(folder, data, key):
            if not all(part.isidentifier() and not iskeyword(part) for part in path.parts):
                raise ValueError(f"{folder.name}: {path} is not a valid Python package path")
            if path in packages:
                raise ValueError(f"{folder.name}: {path} is listed twice in {CATALOG_FILE}")
            packages[path] = kind
    if not packages:
        raise ValueError(f"{folder.name}: {CATALOG_FILE} lists no tools or skills")
    for path in packages:
        if any(parent in packages for parent in path.parents):
            raise ValueError(f"{folder.name}: {path} is inside another listed package")
    env = _catalog_paths(folder, data, "env")
    for path in env:
        if path.name not in _ENV_EXAMPLE_NAMES:
            raise ValueError(
                f"{folder.name}: {path} in {CATALOG_FILE} must be named env.example or .env.example"
            )
        if env.count(path) > 1:
            raise ValueError(f"{folder.name}: {path} is listed twice in {CATALOG_FILE}")
        _local_file(root, Path(path), f"{folder.name}: environment example {path}")
    return Catalog(packages, env)


def _catalog_paths(folder: Path, data: dict[str, object], key: str) -> tuple[PurePosixPath, ...]:
    values = data.get(key, [])
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        raise ValueError(f'{folder.name}: "{key}" in {CATALOG_FILE} must be a list of paths')
    paths: list[PurePosixPath] = []
    for value in cast(list[str], values):
        path = PurePosixPath(value)
        if (
            str(path) != value
            or path.is_absolute()
            or any(part in (".", "..") for part in path.parts)
            or "\\" in value
        ):
            raise ValueError(
                f"{folder.name}: {value!r} in {CATALOG_FILE} must be a relative path inside the folder"
            )
        paths.append(path)
    return tuple(paths)


def load_local_packages(config_dir: Path) -> dict[Path, tuple[Capability, ...]]:
    """Load packages from local/, retaining their paths.

    Parent registration files are never executed. Successful loads are cached
    per configuration; restart the API to discover private changes.
    Failures discard the isolated namespace so corrected packages can be retried.
    """
    config_dir = config_dir.resolve()
    with _IMPORT_LOCK:
        try:
            return _load_local_packages(config_dir)
        except Exception as exc:
            raise RuntimeError(f"Invalid local capabilities for {config_dir}: {exc}") from exc


@cache
def _load_local_packages(config_dir: Path) -> dict[Path, tuple[Capability, ...]]:
    root = (config_dir / "local").resolve()
    packages = {root: _discover_packages(root)}
    dependencies = _prepare_dependencies(config_dir, packages)
    namespace = _LOCAL_PACKAGE_PREFIX + sha256(str(config_dir).encode()).hexdigest()
    with ExitStack() as rollback:
        rollback.callback(_discard_namespace, namespace)
        if dependencies is not None:
            sys.path.append(str(dependencies))
            rollback.callback(sys.path.remove, str(dependencies))
        _register_namespace(namespace, config_dir)
        capabilities = _import_packages(root, packages[root], f"{namespace}.source_0", {})
        # Keep successful imports available; unwind partial imports on any failure.
        rollback.pop_all()
    return capabilities


def _discover_packages(root: Path) -> dict[Path, Kind | None]:
    """Find packages under skills/ and tools/, and those each imported folder's catalog lists."""
    packages: dict[Path, Kind | None] = {}
    for kind in ("skills", "tools", "imports"):
        directory = root / kind
        if not directory.exists():
            continue
        if not directory.resolve().is_relative_to(root) or not directory.is_dir():
            raise ValueError(f"invalid local capability directory {directory}")
        for child in sorted(directory.iterdir()):
            if kind == "imports":
                # Hidden folders are imports still being staged.
                if child.is_dir() and not child.name.startswith("."):
                    packages.update(_catalog_packages(root, child, read_catalog(child)))
                continue
            entrypoint = child / "__init__.py"
            if not child.is_dir() or not (entrypoint.exists() or entrypoint.is_symlink()):
                continue
            if not child.name.isidentifier() or iskeyword(child.name):
                raise ValueError(f"invalid Python package name: {child}")
            package = child.relative_to(root)
            _local_file(root, package / "__init__.py", "package entrypoint")
            packages[package] = None
    return packages


def _catalog_packages(
    root: Path, folder: Path, catalog: Catalog
) -> dict[Path, Kind | None]:
    if not folder.name.isidentifier() or iskeyword(folder.name):
        raise ValueError(f"invalid imported folder name: {folder}")
    if folder.is_symlink() or not folder.resolve().is_relative_to(root):
        raise ValueError(f"imported folder must stay inside {root}: {folder}")
    base = folder.relative_to(root)
    for path in catalog.packages:
        _local_file(root, base / path / "__init__.py", f"{folder.name}: package {path}")
    return {base / path: kind for path, kind in catalog.packages.items()}


def _register_namespace(name: str, directory: Path) -> None:
    module = ModuleType(name)
    module.__path__ = [str(directory)]
    module.__package__ = name
    module.__spec__ = ModuleSpec(name, loader=None, is_package=True)
    module.__spec__.submodule_search_locations = module.__path__
    sys.modules[name] = module


def _discard_namespace(name: str) -> None:
    for key in tuple(sys.modules):
        if key == name or key.startswith(name + "."):
            del sys.modules[key]


def _import_packages(
    root: Path, packages: dict[Path, Kind | None], namespace: str, labels: dict[str, Path]
) -> dict[Path, tuple[Capability, ...]]:
    invalidate_caches()
    _register_namespace(namespace, root)
    for kind in ("skills", "tools", "imports"):
        _register_namespace(f"{namespace}.{kind}", root / kind)
    capabilities: dict[Path, tuple[Capability, ...]] = {}
    for package, expected in packages.items():
        # Folders above a listed package are namespaces; their __init__.py never runs.
        for depth in range(2, len(package.parts)):
            parent = f"{namespace}.{'.'.join(package.parts[:depth])}"
            if parent not in sys.modules:
                _register_namespace(parent, root.joinpath(*package.parts[:depth]))
        entrypoint = root / package / "__init__.py"
        values = _import_capabilities(f"{namespace}.{'.'.join(package.parts)}", entrypoint)
        for capability in values:
            if expected is not None and capability.label.kind != expected:
                raise ValueError(
                    f"{entrypoint}: listed under {expected}s in {CATALOG_FILE} but exports "
                    f"{capability.label.kind} {capability.label.name!r}"
                )
            label = capability.label.name
            if label in labels:
                raise ValueError(
                    f"duplicate capability name {label!r} in {entrypoint}; also exported by "
                    f"{labels[label]}. Give each capability a unique label name"
                )
            labels[label] = entrypoint
        capabilities[root / package] = values
    return capabilities


def _import_capabilities(module_name: str, entrypoint: Path) -> tuple[Capability, ...]:
    try:
        module = import_module(module_name)
        names = getattr(module, "__all__", [name for name in vars(module) if not name.startswith("_")])
        exports = [getattr(module, name) for name in names]
        values: list[Capability] = []
        for value in exports:
            if isinstance(value, Capability) and all(value is not prior for prior in values):
                values.append(value)
        for value in exports:
            if (isinstance(value, type) and issubclass(value, Capability) and value is not Capability
                    and not any(type(instance) is value for instance in values)):
                values.append(cast(Callable[[], Capability], value)())
        if not values:
            raise TypeError("export a RoboZ Capability instance or a Capability subclass with a no-argument constructor")
        for value in values:
            if not callable(value.build):
                raise TypeError("a Capability must provide build()")
            if value.value is None and type(value).build is Capability.build:
                raise TypeError("a Capability without a value must implement build()")
        return tuple(values)
    except Exception as exc:
        raise RuntimeError(f"{entrypoint}: {exc}") from exc


def _local_file(root: Path, relative: Path, label: str) -> Path:
    file = (root / relative).resolve()
    if relative.is_absolute() or not file.is_relative_to(root) or not file.is_file():
        raise ValueError(f"{label}: missing or invalid local file {relative}")
    return file


def _prepare_dependencies(
    config_dir: Path, packages: dict[Path, dict[Path, Kind | None]]
) -> Path | None:
    requirements = [
        _local_file(root, package / "requirements.txt", "requirements file")
        for root, paths in packages.items()
        for package in paths
        if package.parts[0] != "imports" or (root / package / "requirements.txt").exists()
    ]
    if not any(file.read_text(encoding="utf-8").strip() for file in requirements):
        return None
    return _install_requirements(config_dir, requirements)


def inspect_import(
    config_dir: Path, folder: Path, catalog: Catalog
) -> tuple[Capability, ...]:
    """Validate a staged folder's listed packages with the startup loader, without activating them."""
    with _IMPORT_LOCK, ExitStack() as cleanup:
        local_root = (config_dir / "local").resolve()
        packages = {local_root: _discover_packages(local_root)}
        # Staging uses the same imports/<name> layout as committed folders.
        root = folder.parent.parent
        packages[root] = _catalog_packages(root, folder, catalog)
        dependencies = _prepare_dependencies(config_dir, packages)
        if dependencies is not None:
            sys.path.append(str(dependencies))
            cleanup.callback(sys.path.remove, str(dependencies))
        namespace = _LOCAL_PACKAGE_PREFIX + uuid4().hex
        cleanup.callback(_discard_namespace, namespace)
        imported = _import_packages(root, packages[root], namespace, {})
        return tuple(value for values in imported.values() for value in values)


def _install_requirements(config_dir: Path, requirements: list[Path]) -> Path:
    uv = which("uv")
    if uv is None:
        raise RuntimeError("Local capability dependencies require uv in the API environment")
    target = _dependency_cache(config_dir)
    target.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=target.parent) as temporary:
        constraints = Path(temporary) / "base-constraints.txt"
        _write_installed_constraints(constraints)
        command = [
            uv, "pip", "install", "--python", sys.executable,
            "--target", str(target), "--constraint", str(constraints),
        ]
        for requirements_file in requirements:
            command.extend(("-r", str(requirements_file)))
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=180, check=False
        )
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            files = ", ".join(str(file) for file in requirements)
            raise RuntimeError(
                f"Could not install local requirements ({files}). "
                "Dependencies must be compatible with each other and the pinned "
                f"application environment: {detail}"
            )
    return target


def _dependency_cache(config_dir: Path) -> Path:
    # Native development and the container must not share installed binary packages.
    environment = sha256(str(Path(sys.prefix).resolve()).encode()).hexdigest()[:8]
    key = f"{sys.implementation.cache_tag}-{get_platform()}-{environment}"
    return config_dir / ".runtime" / "local-deps" / key


def _write_installed_constraints(path: Path) -> None:
    installed = {
        distribution.metadata["Name"]: distribution.version
        for distribution in distributions()
        if distribution.metadata["Name"]
    }
    path.write_text(
        "".join(f"{name}=={version}\n" for name, version in sorted(installed.items()))
    )
