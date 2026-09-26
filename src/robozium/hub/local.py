"""Optional private capabilities kept beside the selected hub configuration."""

from hashlib import sha256
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from sys import modules
from threading import RLock
from types import ModuleType
from typing import cast

from roboz.deployment import AgentCapability

_IMPORT_LOCK = RLock()


def _import_package(name: str, entrypoint: Path) -> ModuleType:
    cached = modules.get(name)
    if cached is not None:
        return cached
    spec = spec_from_file_location(
        name, entrypoint, submodule_search_locations=[str(entrypoint.parent)]
    )
    if spec is None or spec.loader is None:
        raise ImportError("could not create the local package loader")
    module = module_from_spec(spec)
    modules[name] = module
    spec.loader.exec_module(module)
    return module


def _load_capabilities(name: str, entrypoint: Path) -> tuple[AgentCapability, ...]:
    try:
        module = _import_package(name, entrypoint)
        capabilities = getattr(module, "CAPABILITIES", ())
        if not isinstance(capabilities, (list, tuple)):
            raise TypeError("CAPABILITIES must be a list or tuple")
        return tuple(
            cast(list[AgentCapability] | tuple[AgentCapability, ...], capabilities)
        )
    except BaseException as exc:
        # A failed import may leave private submodules cached. Remove the whole
        # package so a retry cannot reuse incomplete inputs.
        package_modules = [
            key for key in tuple(modules) if key == name or key.startswith(name + ".")
        ]
        for key in package_modules:
            del modules[key]
        if not isinstance(exc, Exception):
            raise
        raise RuntimeError(f"Invalid local capabilities {entrypoint}: {exc}") from exc


def load_local_capabilities(config_dir: Path) -> tuple[AgentCapability, ...]:
    """Import local/__init__.py once per resolved directory and return its exports.

    Relative imports stay inside this private package; neither the working
    directory nor sys.path selects it. CAPABILITIES may be a list or tuple.
    A missing entrypoint or export means no additions. Importing declares
    capabilities only; the existing deployment binds them to each fresh run.
    Restart the API to reload successfully imported private code.
    """
    package_dir = (config_dir / "local").resolve()
    entrypoint = package_dir / "__init__.py"
    if not entrypoint.is_file():
        return ()
    name = "_robozium_local_" + sha256(str(package_dir).encode()).hexdigest()
    with _IMPORT_LOCK:
        return _load_capabilities(name, entrypoint)
