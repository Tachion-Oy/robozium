"""Discover private CLI-created capability packages beside hub.config.py."""

import subprocess
import sys
from collections.abc import Sequence
from hashlib import sha256
from importlib import import_module, invalidate_caches
from importlib.abc import MetaPathFinder
from importlib.machinery import ModuleSpec, PathFinder, SourceFileLoader
from importlib.metadata import distributions
from keyword import iskeyword
from pathlib import Path
from shutil import which
from sysconfig import get_platform
from tempfile import TemporaryDirectory
from threading import RLock
from types import CodeType, ModuleType

from roboz.deployment import Capability

_IMPORT_LOCK = RLock()
_CAPABILITY_CACHE: dict[Path, tuple[Capability, ...]] = {}
_LOCAL_PACKAGE_PREFIX = "_robozium_local_"


def load_local_capabilities(config_dir: Path) -> tuple[Capability, ...]:
    """Install and import immediate packages in local/tools and local/skills.

    Parent registration files are never executed. Successful loads are cached
    per resolved local directory; restart the API to discover private changes.
    Failures discard the isolated namespace so corrected packages can be retried.
    """
    root = (config_dir / "local").resolve()
    with _IMPORT_LOCK:
        cached = _CAPABILITY_CACHE.get(root)
        if cached is not None:
            return cached

        name = _LOCAL_PACKAGE_PREFIX + sha256(str(root).encode()).hexdigest()
        finder = _LocalSourceFinder(name)
        dependencies: str | None = None
        location = root
        try:
            packages = _discover_packages(root)
            requirements = [
                _local_file(root, package / "requirements.txt", "requirements file")
                for package in packages
            ]
            if any(file.read_text(encoding="utf-8").strip() for file in requirements):
                dependencies = str(_install_requirements(root, requirements))
                sys.path.append(dependencies)

            invalidate_caches()
            sys.meta_path.insert(0, finder)
            _namespace(name, root)
            for kind in ("skills", "tools"):
                _namespace(f"{name}.{kind}", root / kind)
            capabilities: list[Capability] = []
            labels: dict[str, Path] = {}
            for package in packages:
                location = root / package / "__init__.py"
                module = import_module(f"{name}.{'.'.join(package.parts)}")
                capability = getattr(module, "CAPABILITY", None)
                if not isinstance(capability, Capability) or not callable(capability.build):
                    raise TypeError("export CAPABILITY as a RoboZ Capability instance")
                label = capability.label.name
                if label in labels:
                    raise ValueError(
                        f"duplicate capability name {label!r}; also exported by "
                        f"{labels[label]}. Give each capability a unique label name"
                    )
                labels[label] = location
                capabilities.append(capability)
        except BaseException as exc:
            if finder in sys.meta_path:
                sys.meta_path.remove(finder)
            if dependencies is not None:
                sys.path.remove(dependencies)
            for key in tuple(sys.modules):
                if key == name or key.startswith(name + "."):
                    del sys.modules[key]
            if not isinstance(exc, Exception):
                raise
            raise RuntimeError(f"Invalid local capabilities {location}: {exc}") from exc
        result = tuple(capabilities)
        _CAPABILITY_CACHE[root] = result
        return result


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


def _namespace(name: str, directory: Path) -> None:
    module = ModuleType(name)
    module.__path__ = [str(directory)]
    module.__package__ = name
    module.__spec__ = ModuleSpec(name, loader=None, is_package=True)
    module.__spec__.submodule_search_locations = module.__path__
    sys.modules[name] = module


def _local_file(root: Path, relative: Path, label: str) -> Path:
    file = (root / relative).resolve()
    if relative.is_absolute() or not file.is_relative_to(root) or not file.is_file():
        raise ValueError(f"{label}: missing or invalid local file {relative}")
    return file


def _install_requirements(root: Path, requirements: list[Path]) -> Path:
    uv = which("uv")
    if uv is None:
        raise RuntimeError("Local capability dependencies require uv in the API environment")
    directory = root.parent / ".runtime" / "local-deps"
    # Native development and Docker must not share installed binary packages.
    environment = sha256(str(Path(sys.prefix).resolve()).encode()).hexdigest()[:8]
    target = directory / f"{sys.implementation.cache_tag}-{get_platform()}-{environment}"
    directory.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=directory) as temporary:
        constraints = Path(temporary) / "base-constraints.txt"
        installed = {
            distribution.metadata["Name"]: distribution.version
            for distribution in distributions()
            if distribution.metadata["Name"]
        }
        constraints.write_text(
            "".join(f"{name}=={version}\n" for name, version in sorted(installed.items()))
        )
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


class _LocalSourceLoader(SourceFileLoader):
    def get_code(self, fullname: str) -> CodeType:
        # Private code can change without a size or whole-second mtime change.
        # Read source without reading/writing pyc files, including read-only mounts.
        return compile(self.get_data(self.path), self.path, "exec", dont_inherit=True)


class _LocalSourceFinder(MetaPathFinder):
    """Read fresh source only within one configuration's isolated namespace."""

    def __init__(self, namespace: str) -> None:
        self.prefix = namespace + "."

    def find_spec(
        self, fullname: str, path: Sequence[str] | None, target: ModuleType | None = None
    ) -> ModuleSpec | None:
        if not fullname.startswith(self.prefix):
            return None
        spec = PathFinder.find_spec(fullname, path, target)
        if spec is not None and isinstance(spec.loader, SourceFileLoader):
            spec.loader = _LocalSourceLoader(fullname, spec.loader.path)
        return spec
