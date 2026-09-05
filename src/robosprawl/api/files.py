"""Utilities and implementation for hub-scoped file serving."""

from dataclasses import dataclass
from pathlib import Path

from fastapi import Response
from fastapi.responses import FileResponse, JSONResponse

from robosprawl.workspace import Sandbox


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
