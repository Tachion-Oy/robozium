"""Restrict the API-only desktop runtime before dispatching any endpoint."""

import os

from fastapi.responses import JSONResponse
from starlette.datastructures import Headers
from starlette.types import ASGIApp, Receive, Scope, Send

DESKTOP_ORIGIN = "robozium://app"


def desktop_host() -> str | None:
    """Enable desktop policy only when its configured API port is present."""
    port = os.environ.get("ROBOZIUM_DESKTOP_API_PORT")
    if port is None:
        return None
    if not port.isascii() or not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ValueError("Invalid desktop API port")
    return f"127.0.0.1:{int(port)}"


class DesktopAccessMiddleware:
    """Permit the bundled renderer and originless native clients on one Host."""

    def __init__(self, app: ASGIApp, host: str) -> None:
        self.app = app
        self.host = host

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            origins = headers.getlist("origin")
            browser = any(name.startswith("sec-fetch-") for name in headers)
            if headers.getlist("host") != [self.host] or (
                origins != [DESKTOP_ORIGIN] and (origins or browser)
            ):
                response = JSONResponse(
                    {"detail": "Desktop request origin or host is not allowed"},
                    status_code=403,
                    headers={"Cache-Control": "no-store"},
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
