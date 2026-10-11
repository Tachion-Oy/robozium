"""HTTP endpoints and request limits for the Environment HUD."""

from collections.abc import Generator
from contextlib import contextmanager
from subprocess import TimeoutExpired
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from robozium.api.environment_service import EnvironmentService
from robozium.api.errors import EnvironmentConflictError, ProjectBusyError
from robozium.api.models import (
    EnvironmentEdit,
    EnvironmentImportResult,
    EnvironmentSaveResult,
    EnvironmentView,
)
from robozium.hub import environment as env

router = APIRouter(prefix="/credentials/environment")
_REQUEST_LIMITS = {
    "/credentials/environment": ("application/json", env.MAX_ENV_BYTES),
    "/credentials/environment/import": ("multipart/form-data", env.MAX_PACKAGE_BYTES),
}


@contextmanager
def _environment(request: Request) -> Generator[EnvironmentService]:
    """Translate expected service failures into the same errors for every route."""
    try:
        yield request.app.state.environment
    except (EnvironmentConflictError, ProjectBusyError) as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except TimeoutExpired as exc:
        raise HTTPException(
            503, "Capability dependency installation timed out. Retry the import."
        ) from exc
    except OSError as exc:
        raise HTTPException(
            503, "Environment storage is unavailable. Check access and retry."
        ) from exc


@router.get("", response_model=EnvironmentView)
def get_environment(request: Request) -> EnvironmentView:
    with _environment(request) as environment:
        return environment.read()


@router.post("", response_model=EnvironmentSaveResult)
def save_environment(body: EnvironmentEdit, request: Request) -> EnvironmentSaveResult:
    with _environment(request) as environment:
        environment.save(body)
    return EnvironmentSaveResult()


@router.post("/import", response_model=EnvironmentImportResult)
def import_folder(
    request: Request,
    files: Annotated[list[UploadFile], File()],
) -> EnvironmentImportResult:
    with _environment(request) as environment:
        return environment.import_folder(
            [(file.filename or "", file.file) for file in files]
        )


@router.delete("")
def reset_environment(request: Request) -> dict[str, str]:
    with _environment(request) as environment:
        environment.reset()
    return {"status": "reset"}


def _validate_write_headers(request: Request, content_type: str | None, limit: int) -> None:
    origin = request.headers.get("origin")
    if origin:
        try:
            parsed = urlsplit(origin)
        except ValueError as exc:
            raise HTTPException(403, "Invalid request origin") from exc
        expected = (request.url.scheme, request.url.netloc, "", "", "")
        if parsed != expected:
            raise HTTPException(
                403, "Cross-origin configuration changes are not allowed"
            )
    actual_type = (
        request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    )
    if content_type is not None and actual_type != content_type:
        raise HTTPException(415, f"Expected {content_type}")
    length = request.headers.get("content-length")
    if length is not None:
        try:
            if not length.isascii() or not length.isdecimal():
                raise ValueError
            declared_size = int(length)
        except ValueError as exc:
            raise HTTPException(400, "Invalid Content-Length") from exc
        if declared_size > limit:
            raise HTTPException(413, "Environment request is too large")


class EnvironmentRequestMiddleware:
    """Enforce write boundaries before parsing JSON or multipart request bodies."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] not in _REQUEST_LIMITS:
            await self.app(scope, receive, send)
            return

        async def no_store_send(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-store"
            await send(message)

        if scope["method"] not in {"POST", "DELETE"}:
            await self.app(scope, receive, no_store_send)
            return

        request = Request(scope)
        content_type, limit = (
            (None, 0) if scope["method"] == "DELETE" else _REQUEST_LIMITS[scope["path"]]
        )
        size = 0

        async def bounded_receive() -> Message:
            nonlocal size
            message = await receive()
            size += len(message.get("body", b""))
            if size > limit:
                raise HTTPException(413, "Environment request is too large")
            return message

        try:
            _validate_write_headers(request, content_type, limit)
            await self.app(scope, bounded_receive, no_store_send)
        except HTTPException as exc:
            response = JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
            await response(scope, receive, no_store_send)
