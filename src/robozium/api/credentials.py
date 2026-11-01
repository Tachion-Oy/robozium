"""Unlock encrypted credentials in the API process using RoboZ."""

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
from roboz.endpoints import (
    DEFAULT_ENCRYPTED_ENV_PATH,
    ENCRYPTED_NAMESPACE,
    ENCRYPTED_SUFFIX,
    load_secrets,
)
from starlette.types import ASGIApp, Receive, Scope, Send

from robozium.api.models import CredentialStatus
from robozium.hub import environment as env

router = APIRouter()
logger = logging.getLogger(__name__)
_RUN_PROVIDER_PATH = re.compile(r"^/run/[^/]+/(reply|stream)$")


class LoadedCredentials:
    """Names and fingerprints of keys added through this API instance."""

    def __init__(self, path: Path = DEFAULT_ENCRYPTED_ENV_PATH) -> None:
        self.path = _encrypted_path(path)
        # Set at startup from the environment files; the first save clears it.
        self.setup_required = False
        self.lock = threading.RLock()
        self.keys: dict[str, bytes] = {}
        self.encrypted = {
            name: value for name, value in os.environ.items()
            if name.endswith(ENCRYPTED_SUFFIX) and value.startswith(ENCRYPTED_NAMESPACE)
        }

    def clear(self) -> None:
        """Remove values unlocked by this process unless something replaced them."""
        with self.lock:
            for name, fingerprint in self.keys.items():
                value = os.environ.get(name)
                if value is not None and _fingerprint(value) == fingerprint:
                    os.environ.pop(name, None)
            self.keys.clear()

    def load(self, password: str | None) -> None:
        """Load saved settings into this process, tracking values it adds for clear()."""
        with self.lock:
            before = {
                name: os.environ.get(name)
                for name in _credential_names(self.path) | {name.removesuffix(ENCRYPTED_SUFFIX) for name in self.encrypted}
            }
            load_secrets(self.path, password=password)
            self.keys.update(
                {
                    name: _fingerprint(value)
                    for name in before
                    if (value := os.environ.get(name)) is not None and before[name] != value
                }
            )

    def reset(self) -> None:
        """Delete saved settings and forget loaded credentials without a password."""
        with self.lock:
            self.path.unlink(missing_ok=True)
            self.clear()
            for name, value in self.encrypted.items():
                if os.environ.get(name) == value:
                    os.environ.pop(name, None)
            self.encrypted.clear()


def _fingerprint(value: str) -> bytes:
    return hashlib.sha256(value.encode()).digest()


def _encrypted_path(default: Path = DEFAULT_ENCRYPTED_ENV_PATH) -> Path:
    return Path(os.environ.get(env.ENCRYPTED_ENV_PATH, str(default)))


def _credential_names(path: Path) -> set[str]:
    return {
        name.removesuffix(ENCRYPTED_SUFFIX)
        for name in dotenv_values(path, interpolate=False)
        if name.endswith(ENCRYPTED_SUFFIX)
    }


def load_environment_files() -> None:
    """Fill unset process values from the saved settings the desktop names, then its manual .env.

    The manual .env overrides saved settings, and values the container sets win over both.
    Without the desktop's path nothing is read, so other runs never pick up a checkout's .env.
    """
    configured = os.environ.get(env.ENCRYPTED_ENV_PATH)
    if not configured:
        return
    path = Path(configured)
    values: dict[str, str | None] = {}
    for file in (path, path.parent / ".env"):
        if file.is_file():
            values.update(dotenv_values(file, interpolate=False))
    for name, value in values.items():
        if value is not None:
            os.environ.setdefault(name, value)


def missing_environment_files(path: Path) -> bool:
    """Whether no settings are saved: no manual .env, and saved settings at most list repositories.

    Repositories can be added before any key is entered, so they never end first-start setup.
    """
    if (path.parent / ".env").is_file():
        return False
    names = list(dotenv_values(path, interpolate=False)) if path.is_file() else []
    return not path.is_file() or bool(names) and all(name.startswith(env.REPOSITORY_PREFIX) for name in names)


def credential_status(loaded: LoadedCredentials | None = None) -> CredentialStatus:
    """Report only whether encrypted keys exist and are loaded."""
    setup_required = bool(loaded and loaded.setup_required)
    path = loaded.path if loaded else _encrypted_path()
    values = dict(dotenv_values(path, interpolate=False)) if path.is_file() else {}
    values.update(loaded.encrypted if loaded else os.environ)
    encrypted_names = [
        name.removesuffix(ENCRYPTED_SUFFIX)
        for name, value in values.items()
        if name.endswith(ENCRYPTED_SUFFIX)
        and value
        and value.startswith(ENCRYPTED_NAMESPACE)
    ]
    if not encrypted_names:
        return CredentialStatus(
            available=False, locked=False, removable=False, setup_required=setup_required
        )
    locked = any(
        name not in os.environ
        for name in encrypted_names
    )
    tracked = bool(loaded and loaded.keys)
    available = locked or tracked
    return CredentialStatus(
        available=available,
        locked=locked,
        removable=bool(tracked and not locked),
        setup_required=setup_required,
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
    """Hold provider actions while encrypted API keys are locked or never configured."""

    def __init__(self, app: ASGIApp, loaded: LoadedCredentials) -> None:
        self.app = app
        self.loaded = loaded

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        detail = None
        if scope["type"] == "http" and _uses_provider(scope["method"], scope["path"]):
            if self.loaded.setup_required:
                detail = "Add API keys before using providers"
            elif credential_status(self.loaded).locked:
                detail = "Unlock secrets before using providers"
        if detail is not None:
            response = JSONResponse(
                {"detail": detail},
                status_code=423,
                headers={"Cache-Control": "no-store"},
            )
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)


async def refresh_dependencies(request: Request) -> None:
    """Re-check dependencies after keys load; observations never fail the request."""
    monitor = request.app.state.dependency_health
    if monitor is not None:
        try:
            await monitor.run_once()
        except Exception:
            logger.warning("Dependency refresh failed after loading API keys")


@router.get("/credentials", response_model=CredentialStatus)
def get_credentials(request: Request, response: Response) -> CredentialStatus:
    response.headers["Cache-Control"] = "no-store"
    return credential_status(request.app.state.loaded_credentials)


@router.post("/credentials/unlock", response_model=CredentialStatus)
async def unlock_credentials(request: Request, response: Response) -> CredentialStatus:
    if not credential_status(request.app.state.loaded_credentials).available:
        raise HTTPException(
            status_code=404, detail="Encrypted secrets are unavailable"
        )
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > env.MAX_UNLOCK_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Unlock request is too large")
    try:
        payload = json.loads(body)
    except (UnicodeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid unlock request") from None
    password = payload.get("password") if isinstance(payload, dict) else None
    if not isinstance(password, str) or not password or len(password) > env.MAX_PASSWORD_CHARS:
        raise HTTPException(status_code=400, detail="A password is required")
    loaded: LoadedCredentials = request.app.state.loaded_credentials
    try:
        await asyncio.to_thread(loaded.load, password)
    except (UnicodeError, ValueError):
        raise HTTPException(
            status_code=400, detail="Could not unlock secrets"
        ) from None
    await refresh_dependencies(request)
    response.headers["Cache-Control"] = "no-store"
    return credential_status(loaded)


@router.post("/credentials/clear", response_model=CredentialStatus)
def clear_credentials(request: Request, response: Response) -> CredentialStatus:
    loaded: LoadedCredentials = request.app.state.loaded_credentials

    loaded.clear()
    response.headers["Cache-Control"] = "no-store"
    return credential_status(loaded)
