"""Unlock an encrypted dotenv file in the API process."""

import asyncio
import hashlib
import json
import logging
import os
import threading
from http import HTTPMethod
from pathlib import Path

from dotenv import dotenv_values
from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from roboz.endpoints import (
    DEFAULT_ENCRYPTED_ENV_PATH,
    ENCRYPTED_NAMESPACE,
    SECRET_SUFFIX,
    load_secrets,
)
from starlette.routing import compile_path
from starlette.types import ASGIApp, Receive, Scope, Send

from robozium.api.models import CredentialStatus
from robozium.api.routes import (
    CREDENTIALS_CLEAR_PATH,
    CREDENTIALS_PATH,
    CREDENTIALS_UNLOCK_PATH,
    RUN_CREATE_PATH,
    RUN_REPLY_PATH,
    RUN_STREAM_PATH,
    TRANSCRIBE_PATH,
)

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_UNLOCK_BODY_BYTES = 4096
MAX_UNLOCK_PASSWORD_CHARS = 1024
ENCRYPTED_ENV_PATH_ENV = "ROBOZIUM_ENCRYPTED_ENV_PATH"
MODE_ENV = "ROBOZIUM_MODE"
LIVE_MODE = "live"
CACHE_CONTROL_HEADER = "Cache-Control"
NO_STORE_CACHE_CONTROL = "no-store"
_PROVIDER_ROUTES = tuple(
    (method, compile_path(path)[0])
    for method, path in (
        (HTTPMethod.POST, RUN_CREATE_PATH),
        (HTTPMethod.POST, RUN_REPLY_PATH),
        (HTTPMethod.GET, RUN_STREAM_PATH),
        (HTTPMethod.POST, TRANSCRIBE_PATH),
    )
)


class LoadedCredentials:
    """Names and fingerprints of keys added through this API instance."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.keys: dict[str, bytes] = {}


def _fingerprint(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def _encrypted_path() -> Path:
    return Path(os.environ.get(ENCRYPTED_ENV_PATH_ENV, str(DEFAULT_ENCRYPTED_ENV_PATH)))


def _credential_names(path: Path) -> set[str]:
    return {
        name
        for name in dotenv_values(path, interpolate=False)
        if name.endswith(SECRET_SUFFIX)
    }


def credential_status(loaded: LoadedCredentials | None = None) -> CredentialStatus:
    """Report only whether encrypted keys exist and are loaded."""
    if os.environ.get(MODE_ENV) != LIVE_MODE:
        return CredentialStatus(available=False, locked=False, removable=False)
    path = _encrypted_path()
    if not path.is_file():
        return CredentialStatus(available=False, locked=False, removable=False)
    encrypted_names = [
        name
        for name, value in dotenv_values(path, interpolate=False).items()
        if name.endswith(SECRET_SUFFIX)
        and value
        and value.startswith(ENCRYPTED_NAMESPACE)
    ]
    if not encrypted_names:
        return CredentialStatus(available=False, locked=False, removable=False)
    locked = any(
        not (value := os.environ.get(name))
        or not value.strip()
        or value.startswith(ENCRYPTED_NAMESPACE)
        for name in encrypted_names
    )
    tracked = bool(loaded and loaded.keys)
    available = locked or tracked
    return CredentialStatus(
        available=available,
        locked=locked,
        removable=bool(tracked and not locked),
    )


def _uses_provider(method: str, path: str) -> bool:
    return any(
        method == provider_method and pattern.fullmatch(path) is not None
        for provider_method, pattern in _PROVIDER_ROUTES
    )


class CredentialGateMiddleware:
    """Hold provider actions while encrypted API keys are locked."""

    def __init__(self, app: ASGIApp, loaded: LoadedCredentials) -> None:
        self.app = app
        self.loaded = loaded

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and _uses_provider(scope["method"], scope["path"])
            and credential_status(self.loaded).locked
        ):
            response = JSONResponse(
                {"detail": "Unlock API keys before using providers"},
                status_code=status.HTTP_423_LOCKED,
                headers={CACHE_CONTROL_HEADER: NO_STORE_CACHE_CONTROL},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


@router.get(CREDENTIALS_PATH, response_model=CredentialStatus)
def get_credentials(request: Request, response: Response) -> CredentialStatus:
    response.headers[CACHE_CONTROL_HEADER] = NO_STORE_CACHE_CONTROL
    return credential_status(request.app.state.loaded_credentials)


@router.post(CREDENTIALS_UNLOCK_PATH, response_model=CredentialStatus)
async def unlock_credentials(request: Request, response: Response) -> CredentialStatus:
    if not credential_status(request.app.state.loaded_credentials).available:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Encrypted API keys are unavailable",
        )
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_UNLOCK_BODY_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail="Unlock request is too large",
            )
    try:
        payload = json.loads(body)
    except (UnicodeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid unlock request"
        ) from None
    password = payload.get("password") if isinstance(payload, dict) else None
    if (
        not isinstance(password, str)
        or not password
        or len(password) > MAX_UNLOCK_PASSWORD_CHARS
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="A password is required"
        )
    loaded: LoadedCredentials = request.app.state.loaded_credentials

    def load_and_track() -> None:
        with loaded.lock:
            before = {
                name: os.environ.get(name)
                for name in _credential_names(_encrypted_path())
            }
            load_secrets(_encrypted_path(), password=password)
            loaded.keys.update(
                {
                    name: _fingerprint(value)
                    for name in before
                    if (value := os.environ.get(name)) and before[name] != value
                }
            )

    try:
        await asyncio.to_thread(load_and_track)
    except (UnicodeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Could not unlock API keys"
        ) from None
    monitor = request.app.state.dependency_health
    if monitor is not None:
        try:
            await monitor.run_once()
        except Exception:
            # Dependency observations must not turn a successful unlock into a retry.
            logger.warning("Dependency refresh failed after API key unlock")
    response.headers[CACHE_CONTROL_HEADER] = NO_STORE_CACHE_CONTROL
    return credential_status(loaded)


@router.post(CREDENTIALS_CLEAR_PATH, response_model=CredentialStatus)
def clear_credentials(request: Request, response: Response) -> CredentialStatus:
    loaded: LoadedCredentials = request.app.state.loaded_credentials

    def clear() -> None:
        with loaded.lock:
            for name, fingerprint in loaded.keys.items():
                value = os.environ.get(name)
                if value is not None and _fingerprint(value) == fingerprint:
                    os.environ.pop(name, None)
            loaded.keys.clear()

    clear()
    response.headers[CACHE_CONTROL_HEADER] = NO_STORE_CACHE_CONTROL
    return credential_status(loaded)
