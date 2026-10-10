"""Environment management, guarded by the same admission lock as run creation."""

import asyncio
import os
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from pydantic import ValidationError

from robozium.api.errors import ProjectBusyError
from robozium.api.project_service import ProjectService
from robozium.settings.environment import (
    MAX_BYTES,
    EnvironmentConflict,
    EnvironmentEdit,
    EnvironmentStore,
)

router = APIRouter()


def attach_environment(app: FastAPI, root: Path, projects: ProjectService | None) -> None:
    """Bind storage to the checkout, never the agent's writable hub."""
    configured_root = Path(os.environ.get("ROBOZIUM_ENV_ROOT", str(root)))
    control = os.environ.get("ROBOZIUM_ENV_CONTROL")
    app.state.environment_store = EnvironmentStore(
        configured_root, control=Path(control) if control else None,
    )
    app.state.environment_projects = projects
    app.include_router(router)


def _available(request: Request) -> bool:
    store: EnvironmentStore = request.app.state.environment_store
    projects: ProjectService | None = request.app.state.environment_projects
    with store.lock:
        status = store.operation()
        if status.startswith("failed") and projects is not None:
            projects.end_configuration()
        return status not in {"pending", "applying"} and (
            projects is None or projects.configuration_available()
        )



@router.get("/admin/environment")
def environment_get(request: Request, response: Response) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    store: EnvironmentStore = request.app.state.environment_store
    try:
        result = store.snapshot()
        suggestions, errors = store.suggestions()
    except (OSError, UnicodeError, ValueError):
        raise HTTPException(400, "Could not read root environment configuration") from None
    result.update(editable=_available(request), suggestions=suggestions, example_errors=errors)
    return result


@router.post("/admin/environment", status_code=202)
async def environment_save(request: Request, response: Response) -> dict[str, object]:
    response.headers["Cache-Control"] = "no-store"
    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
        raise HTTPException(403, "Cross-origin configuration changes are not allowed")
    if request.headers.get("content-type", "").split(";")[0] != "application/json":
        raise HTTPException(415, "Configuration changes require JSON")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BYTES:
            raise HTTPException(413, "Environment request is too large")
    try:
        edit = EnvironmentEdit.model_validate_json(body)
    except (ValueError, ValidationError):
        raise HTTPException(400, "Invalid environment request") from None
    store: EnvironmentStore = request.app.state.environment_store
    projects: ProjectService | None = request.app.state.environment_projects

    def apply() -> None:
        with store.lock:
            if projects is not None:
                projects.begin_configuration()
            try:
                store.save(edit)
            except BaseException:
                if projects is not None:
                    projects.end_configuration()
                raise
            if store.control is None and projects is not None:
                projects.end_configuration()

    try:
        await asyncio.to_thread(apply)
    except (ProjectBusyError, EnvironmentConflict) as exc:
        raise HTTPException(409, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    except OSError:
        raise HTTPException(503, "Could not save environment configuration") from None
    port = next((row.value for row in edit.entries if row.name == "ROBOZIUM_WEB_PORT"), "6969")
    _, _, overrides = store.documents()
    port = os.environ.get("ROBOZIUM_LAUNCHER_WEB_PORT") or overrides.get("ROBOZIUM_WEB_PORT") or port
    return {
        "operation": "pending" if store.control else "saved", "generation": store.generation,
        "web_port": int(port) if store.control and port and port.isdecimal() else None,
    }
