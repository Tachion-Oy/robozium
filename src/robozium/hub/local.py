"""Discover private CLI-created capability packages beside hub.config.py."""

import subprocess
import sys
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

from roboz.deployment import Capability

_IMPORT_LOCK = RLock()
_LOCAL_PACKAGE_PREFIX = "_robozium_local_"


def load_local_capabilities(config_dir: Path) -> tuple[Capability, ...]:
    """Install and import immediate packages in local/tools and local/skills.

    Parent registration files are never executed. Successful loads are cached
    per resolved local directory; restart the API to discover private changes.
    Failures discard the isolated namespace so corrected packages can be retried.
    """
    root = (config_dir / "local").resolve()
    with _IMPORT_LOCK:
        try:
            return _load_local_capabilities(root)
        except Exception as exc:
            raise RuntimeError(f"Invalid local capabilities {root}: {exc}") from exc


@cache
def _load_local_capabilities(root: Path) -> tuple[Capability, ...]:
    packages = _discover_packages(root)
    dependencies = _prepare_dependencies(root, packages)
    namespace = _LOCAL_PACKAGE_PREFIX + sha256(str(root).encode()).hexdigest()
    with ExitStack() as rollback:
        rollback.callback(_discard_namespace, namespace)
        if dependencies is not None:
            sys.path.append(str(dependencies))
            rollback.callback(sys.path.remove, str(dependencies))
        capabilities = _import_packages(root, packages, namespace)
        # Keep successful imports available; unwind partial imports on any failure.
        rollback.pop_all()
    return capabilities


def _discover_packages(root: Path) -> list[Path]:
    packages: list[Path] = []
    for kind in ("skills", "tools"):
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
    root: Path, packages: list[Path], namespace: str
) -> tuple[Capability, ...]:
    invalidate_caches()
    _register_namespace(namespace, root)
    for kind in ("skills", "tools"):
        _register_namespace(f"{namespace}.{kind}", root / kind)
    capabilities: list[Capability] = []
    labels: dict[str, Path] = {}
    for package in packages:
        entrypoint = root / package / "__init__.py"
        capability = _import_capability(f"{namespace}.{'.'.join(package.parts)}", entrypoint)
        label = capability.label.name
        if label in labels:
            raise ValueError(
                f"duplicate capability name {label!r} in {entrypoint}; also exported by "
                f"{labels[label]}. Give each capability a unique label name"
            )
        labels[label] = entrypoint
        capabilities.append(capability)
    return tuple(capabilities)


def _import_capability(module_name: str, entrypoint: Path) -> Capability:
    try:
        module = import_module(module_name)
        capability = getattr(module, "CAPABILITY", None)
        if not isinstance(capability, Capability) or not callable(capability.build):
            raise TypeError("export CAPABILITY as a RoboZ Capability instance")
        return capability
    except Exception as exc:
        raise RuntimeError(f"{entrypoint}: {exc}") from exc


def _local_file(root: Path, relative: Path, label: str) -> Path:
    file = (root / relative).resolve()
    if relative.is_absolute() or not file.is_relative_to(root) or not file.is_file():
        raise ValueError(f"{label}: missing or invalid local file {relative}")
    return file


def _prepare_dependencies(root: Path, packages: list[Path]) -> Path | None:
    requirements = [
        _local_file(root, package / "requirements.txt", "requirements file")
        for package in packages
    ]
    if not any(file.read_text(encoding="utf-8").strip() for file in requirements):
        return None
    return _install_requirements(root, requirements)


def _install_requirements(root: Path, requirements: list[Path]) -> Path:
    uv = which("uv")
    if uv is None:
        raise RuntimeError("Local capability dependencies require uv in the API environment")
    target = _dependency_cache(root)
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
            files = ", ".join(str(file.relative_to(root)) for file in requirements)
            raise RuntimeError(f"Could not install local requirements ({files}): {detail}")
    return target


def _dependency_cache(root: Path) -> Path:
    # Native development and Docker must not share installed binary packages.
    environment = sha256(str(Path(sys.prefix).resolve()).encode()).hexdigest()[:8]
    key = f"{sys.implementation.cache_tag}-{get_platform()}-{environment}"
    return root.parent / ".runtime" / "local-deps" / key


def _write_installed_constraints(path: Path) -> None:
    installed = {
        distribution.metadata["Name"]: distribution.version
        for distribution in distributions()
        if distribution.metadata["Name"]
    }
    path.write_text(
        "".join(f"{name}=={version}\n" for name, version in sorted(installed.items()))
    )
