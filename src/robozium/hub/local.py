"""Load private capabilities declared beside hub.config.py."""

import subprocess
import sys
from dataclasses import dataclass
from hashlib import sha256
from importlib.metadata import distributions
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from pkgutil import resolve_name
from shutil import which
from sysconfig import get_platform
from tempfile import TemporaryDirectory
from threading import RLock
from types import ModuleType

from roboz.deployment import Capability

_IMPORT_LOCK = RLock()
_CAPABILITY_CACHE: dict[Path, tuple[Capability, ...]] = {}
_LOCAL_PACKAGE_PREFIX = "_robozium_local_"


@dataclass(frozen=True)
class LocalTool:
    """Declare a ``module:factory`` and requirements file relative to local/.

    The factory takes no arguments and returns a Capability.
    """

    entrypoint: str
    requirements: str


def load_local_capabilities(config_dir: Path) -> tuple[Capability, ...]:
    """Validate, install, and load private capabilities once per resolved directory.

    Existing capability objects are also accepted. Restart the API to reload
    private code or changed requirements.
    """
    root = (config_dir / "local").resolve()
    entrypoint = root / "__init__.py"
    if not entrypoint.is_file():
        return ()

    with _IMPORT_LOCK:
        cached = _CAPABILITY_CACHE.get(root)
        if cached is not None:
            return cached

        name = _LOCAL_PACKAGE_PREFIX + sha256(str(root).encode()).hexdigest()
        dependencies: str | None = None
        tool_name: str | None = None
        try:
            module = _import_package(name, entrypoint)
            declarations = getattr(module, "CAPABILITIES", ())
            if not isinstance(declarations, (list, tuple)):
                raise TypeError("CAPABILITIES must be a list or tuple")
            requirements = [
                _validate_tool(item, root)
                for item in declarations if isinstance(item, LocalTool)
            ]
            if requirements:
                dependencies = str(_install_requirements(root, requirements))
                sys.path.append(dependencies)

            capabilities: list[Capability] = []
            for declaration in declarations:
                tool_name = None
                if isinstance(declaration, LocalTool):
                    tool_name = declaration.entrypoint
                    factory = resolve_name(f"{name}.{tool_name}")
                    declaration = factory()
                if not isinstance(declaration, Capability) or not callable(
                    declaration.build
                ):
                    raise TypeError("expected a Capability")
                capabilities.append(declaration)
        except BaseException as exc:
            if dependencies is not None:
                sys.path.remove(dependencies)
            # Failed imports must be retryable without partially loaded modules.
            for key in tuple(sys.modules):
                if key == name or key.startswith(name + "."):
                    del sys.modules[key]
            if not isinstance(exc, Exception):
                raise
            detail = f"{tool_name}: {exc}" if tool_name else str(exc)
            raise RuntimeError(f"Invalid local capabilities {entrypoint}: {detail}") from exc
        result = tuple(capabilities)
        _CAPABILITY_CACHE[root] = result
        return result


def _local_file(root: Path, relative: Path, label: str) -> Path:
    file = (root / relative).resolve()
    if relative.is_absolute() or not file.is_relative_to(root) or not file.is_file():
        raise ValueError(f"{label}: missing or invalid local file {relative}")
    return file


def _validate_tool(tool: LocalTool, root: Path) -> Path:
    if not isinstance(tool.entrypoint, str) or not isinstance(tool.requirements, str):
        raise TypeError("LocalTool entrypoint and requirements must be strings")
    module, separator, factory = tool.entrypoint.partition(":")
    if not separator or not all(
        part.isidentifier() for part in (*module.split("."), factory)
    ):
        raise ValueError(f"Invalid local tool entrypoint: {tool.entrypoint!r}")
    source = Path(*module.split("."))
    if (root / source).is_dir():
        source /= "__init__.py"
    else:
        source = source.with_suffix(".py")
    _local_file(root, source, f"{tool.entrypoint}: module")
    return _local_file(root, Path(tool.requirements), f"{tool.entrypoint}: requirements file")


def _install_requirements(root: Path, requirements: list[Path]) -> Path:
    uv = which("uv")
    if uv is None:
        raise RuntimeError("Local tools require uv in the API environment")
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


def _import_package(name: str, entrypoint: Path) -> ModuleType:
    spec = spec_from_file_location(
        name, entrypoint, submodule_search_locations=[str(entrypoint.parent)]
    )
    if spec is None or spec.loader is None:
        raise ImportError(f"Could not import {entrypoint}")
    module = module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
