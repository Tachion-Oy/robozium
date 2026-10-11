"""Discover private capability packages in the application's local directory."""

import subprocess
import sys
from collections.abc import Callable
from contextlib import ExitStack
from functools import cache
from hashlib import sha256
from importlib import import_module, invalidate_caches
from importlib.machinery import ModuleSpec
from importlib.metadata import distributions
from keyword import iskeyword
from pathlib import Path
from shutil import which
from sysconfig import get_platform
from tempfile import TemporaryDirectory
from threading import RLock
from types import ModuleType
from typing import cast
from uuid import uuid4

from roboz.deployment import Capability

_IMPORT_LOCK = RLock()
_LOCAL_PACKAGE_PREFIX = "_robozium_local_"


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


def _discover_packages(root: Path) -> list[Path]:
    packages: list[Path] = []
    for kind in ("skills", "tools", "imports"):
        directory = root / kind
        if not directory.exists():
            continue
        if not directory.resolve().is_relative_to(root) or not directory.is_dir():
            raise ValueError(f"invalid local capability directory {directory}")
        for child in sorted(directory.iterdir()):
            entrypoint = child / "__init__.py"
            if not child.is_dir() or not (entrypoint.exists() or entrypoint.is_symlink()):
                continue
            if not child.name.isidentifier() or iskeyword(child.name):
                raise ValueError(f"invalid Python package name: {child}")
            package = child.relative_to(root)
            _local_file(root, package / "__init__.py", "package entrypoint")
            packages.append(package)
    return packages


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
    root: Path, packages: list[Path], namespace: str, labels: dict[str, Path]
) -> dict[Path, tuple[Capability, ...]]:
    invalidate_caches()
    _register_namespace(namespace, root)
    for kind in ("skills", "tools", "imports"):
        _register_namespace(f"{namespace}.{kind}", root / kind)
    capabilities: dict[Path, tuple[Capability, ...]] = {}
    for package in packages:
        entrypoint = root / package / "__init__.py"
        values = _import_capabilities(f"{namespace}.{'.'.join(package.parts)}", entrypoint)
        for capability in values:
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
    config_dir: Path, packages: dict[Path, list[Path]]
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


def inspect_import(config_dir: Path, package: Path) -> tuple[Capability, ...]:
    """Validate a staged package with the startup loader, without activating it."""
    with _IMPORT_LOCK, ExitStack() as cleanup:
        local_root = (config_dir / "local").resolve()
        packages = {local_root: _discover_packages(local_root)}
        # Staging uses the same imports/<name> layout as committed packages.
        root = package.parent.parent
        packages[root] = [package.relative_to(root)]
        dependencies = _prepare_dependencies(config_dir, packages)
        if dependencies is not None:
            sys.path.append(str(dependencies))
            cleanup.callback(sys.path.remove, str(dependencies))
        namespace = _LOCAL_PACKAGE_PREFIX + uuid4().hex
        cleanup.callback(_discard_namespace, namespace)
        return _import_packages(root, [package.relative_to(root)], namespace, {})[package]


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
    # Native development and Docker must not share installed binary packages.
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
