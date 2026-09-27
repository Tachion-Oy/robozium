"""Unlock an encrypted dotenv file in the API process."""

import asyncio
import hashlib
import json
import logging
import os
import re
import threading
from pathlib import Path

from dotenv import dotenv_values
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from roboz.endpoints import load_secrets
from starlette.types import ASGIApp, Receive, Scope, Send

from robozium.api.models import CredentialStatus

router = APIRouter()
logger = logging.getLogger(__name__)
MAX_UNLOCK_BODY_BYTES = 4096
_RUN_PROVIDER_PATH = re.compile(r"^/run/[^/]+/(reply|stream)$")


class LoadedCredentials:
    """Names and fingerprints of keys added through this API instance."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.keys: dict[str, bytes] = {}


def _fingerprint(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def _encrypted_path() -> Path:
    return Path(os.environ.get("ROBOZIUM_ENCRYPTED_ENV_PATH", ".env.encrypt"))


def _credential_names(path: Path) -> set[str]:
    return {
        name
        for name in dotenv_values(path, interpolate=False)
        if name.endswith("_SECRET")
    }


def credential_status(loaded: LoadedCredentials | None = None) -> CredentialStatus:
    """Report only whether encrypted keys exist and are loaded."""
    if os.environ.get("ROBOZIUM_MODE") != "live":
        return CredentialStatus(available=False, locked=False, removable=False)
    path = _encrypted_path()
    if not path.is_file():
        return CredentialStatus(available=False, locked=False, removable=False)
    encrypted_names = [
        name
        for name, value in dotenv_values(path, interpolate=False).items()
        if name.endswith("_SECRET")
        and value
        and value.startswith("roboz:")
    ]
    if not encrypted_names:
        return CredentialStatus(available=False, locked=False, removable=False)
    locked = any(
        not (value := os.environ.get(name))
        or not value.strip()
        or value.startswith("roboz:")
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
    if (method, path) in {("POST", "/run/create"), ("POST", "/transcribe")}:
        return True
    match = _RUN_PROVIDER_PATH.fullmatch(path)
    return match is not None and (
        (method == "POST" and match[1] == "reply")
        or (method == "GET" and match[1] == "stream")
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
                status_code=423,
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


@router.get("/credentials", response_model=CredentialStatus)
def get_credentials(request: Request, response: Response) -> CredentialStatus:
    response.headers["Cache-Control"] = "no-store"
    return credential_status(request.app.state.loaded_credentials)


@router.post("/credentials/unlock", response_model=CredentialStatus)
async def unlock_credentials(request: Request, response: Response) -> CredentialStatus:
    if not credential_status(request.app.state.loaded_credentials).available:
        raise HTTPException(
            status_code=404, detail="Encrypted API keys are unavailable"
        )
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_UNLOCK_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Unlock request is too large")
    try:
        payload = json.loads(body)
    except (UnicodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid unlock request") from None
    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str) or not password or len(password) > 1024:
        raise HTTPException(status_code=400, detail="A password is required")
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
            status_code=400, detail="Could not unlock API keys"
        ) from None
    monitor = request.app.state.dependency_health
    if monitor is not None:
        try:
            await monitor.run_once()
        except Exception:
            # Dependency observations must not turn a successful unlock into a retry.
            logger.warning("Dependency refresh failed after API key unlock")
    response.headers["Cache-Control"] = "no-store"
    return credential_status(loaded)


@router.post("/credentials/clear", response_model=CredentialStatus)
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
    response.headers["Cache-Control"] = "no-store"
    return credential_status(loaded)
