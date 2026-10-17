"""Serve hub files and stage pasted images for a run's next reply."""

from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from roboz.shed.sandbox import Sandbox
from starlette.concurrency import run_in_threadpool

from robozium.api.run_manager import RunManager
from robozium.hub.application import Hub

router = APIRouter()


@router.get("/files/{path:path}")
def files_get(path: str, request: Request) -> Response:
    hub: Hub = request.app.state.hub
    return serve_hub_file(path, sandbox=hub.settings.sandbox)


@router.post("/run/{run_id}/files")
async def files_upload(
    run_id: str, prompt_id: str, request: Request, filename: str = "image"
) -> dict[str, str]:
    """Upload one image as raw request bytes, before submitting the JSON reply.

    The returned path is readable through /files until the run's workers stop.
    """
    hub: Hub = request.app.state.hub
    manager: RunManager = request.app.state.run_manager
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > hub.settings.attachments.max_image_bytes:
            raise HTTPException(413, "Image exceeds the configured byte limit")
        data.extend(chunk)
    try:
        path = await run_in_threadpool(
            manager.stage_image, run_id, prompt_id, filename, bytes(data)
        )
    except KeyError:
        raise HTTPException(404, "unknown run_id") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"path": path}


def _build_expected_file_tag(requested_path: str) -> str:
    target = requested_path or "relative/path/to/file.txt"
    return f'<file src="{target}">Open generated file</file>'


@dataclass(frozen=True)
class _FileRequestCtx:
    requested_path: str
    resolved_root: Path

    def error(
        self, *, status_code: int, code: str, message: str, hint: str
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status_code,
            content={
                "code": code,
                "message": message,
                "requested_path": self.requested_path,
                "expected_tag": _build_expected_file_tag(self.requested_path),
                "resolved_root": str(self.resolved_root),
                "hint": hint,
            },
            headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )


def serve_hub_file(path: str, *, sandbox: Sandbox) -> Response:
    hub_root = sandbox.resolved_root
    requested_path = path.strip()
    ctx = _FileRequestCtx(requested_path=requested_path, resolved_root=hub_root)

    raw_path = Path(requested_path)
    if not requested_path or raw_path.is_absolute():
        return ctx.error(
            status_code=400,
            code="invalid_requested_path",
            message="Requested file path must be a non-empty hub-relative path.",
            hint='Use <file src="projects/{project}/relative/path.ext">Label</file> (no leading /).',
        )

    resolved_path = (hub_root / raw_path).resolve()
    if not resolved_path.is_relative_to(hub_root):
        return ctx.error(
            status_code=400,
            code="path_escape",
            message="Requested path resolves outside the hub root directory.",
            hint="Files are readable across the hub, but the resolved path must stay within the hub root directory.",
        )
    if not resolved_path.exists():
        return ctx.error(
            status_code=404,
            code="file_not_found",
            message="No file exists at the requested hub file path.",
            hint='Check that the file exists under the hub root and that the HUD link uses a valid <file src="..."> path.',
        )
    if not resolved_path.is_file():
        return ctx.error(
            status_code=404,
            code="not_a_file",
            message="Requested path exists but is not a regular file.",
            hint="Point the URI to a concrete file rather than a directory.",
        )

    response = FileResponse(path=resolved_path)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers.setdefault(
        "Content-Disposition", f'inline; filename="{resolved_path.name}"'
    )
    return response
