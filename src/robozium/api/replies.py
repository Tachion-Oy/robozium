"""Bounded multipart replies alongside the existing JSON reply contract."""

import asyncio
import json
from collections.abc import AsyncGenerator

from fastapi import HTTPException, Request
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from starlette.datastructures import FormData, UploadFile
from starlette.formparsers import MultiPartException, MultiPartParser

from robozium.api.attachments import (
    MAX_IMAGE_BYTES,
    MAX_IMAGES,
    MAX_REPLY_BYTES,
    validate_image,
)
from robozium.api.models import ReplyBody
from robozium.api.run_manager import RunManager


class _CompleteMultipartParser(MultiPartParser):
    """Starlette accepts a truncated final part; replies must finish completely."""

    complete = False

    def on_end(self) -> None:
        self.complete = True
        super().on_end()

    async def parse(self) -> FormData:
        source = self.stream

        async def complete_stream() -> AsyncGenerator[bytes]:
            async for chunk in source:
                yield chunk
            # Raise while Starlette owns parsing so it closes every spool,
            # including the unfinished part that is not yet in FormData.
            if not self.complete:
                raise MultiPartException("Incomplete multipart reply")

        self.stream = complete_stream()
        return await super().parse()


async def _multipart(request: Request) -> FormData:
    length = request.headers.get("content-length")
    if length is not None:
        try:
            oversized = int(length) > MAX_REPLY_BYTES
        except ValueError:
            raise HTTPException(400, "Invalid Content-Length") from None
        if oversized:
            raise HTTPException(413, "Reply body exceeds 41 MiB")
    async def stream() -> AsyncGenerator[bytes]:
        length = 0
        async for chunk in request.stream():
            length += len(chunk)
            if length > MAX_REPLY_BYTES:
                raise HTTPException(413, "Reply body exceeds 41 MiB")
            yield chunk

    try:
        return await _CompleteMultipartParser(
            request.headers,
            stream(),
            max_files=MAX_IMAGES,
            max_fields=2,
        ).parse()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, "Invalid or incomplete multipart reply") from exc


async def submit_http_reply(manager: RunManager, run_id: str, request: Request) -> None:
    content_type = (
        request.headers.get("content-type", "").split(";", 1)[0].lower().strip()
    )
    if content_type != "multipart/form-data":
        try:
            body = ReplyBody.model_validate(await request.json())
        except (json.JSONDecodeError, ValidationError) as exc:
            errors = (
                exc.errors()
                if isinstance(exc, ValidationError)
                else [
                    {
                        "type": "json_invalid",
                        "loc": ("body",),
                        "msg": "Invalid JSON",
                        "input": None,
                    }
                ]
            )
            raise RequestValidationError(errors) from exc
        manager.submit_reply(run_id, body.prompt_id, body.content)
        return

    form = await _multipart(request)
    try:
        if set(form) - {"prompt_id", "content", "images"}:
            raise ValueError("Unknown multipart reply field")
        prompts, contents, images = (
            form.getlist(key) for key in ("prompt_id", "content", "images")
        )
        if (
            len(prompts) != 1
            or not isinstance(prompts[0], str)
            or not prompts[0].strip()
        ):
            raise ValueError("Multipart replies require one prompt_id")
        if len(contents) > 1 or (contents and not isinstance(contents[0], str)):
            raise ValueError("content must be a single text field")
        content = str(contents[0]) if contents else ""
        if not images and not content.strip():
            raise ValueError("A reply must include text or images")
        if len(images) > MAX_IMAGES or any(
            not isinstance(item, UploadFile) for item in images
        ):
            raise ValueError("images must contain at most four image files")
        prompt_id = prompts[0]
        if not images:
            manager.submit_reply(run_id, prompt_id, content)
            return
        manager.validate_image_reply(run_id, prompt_id)
        validated = []
        for upload in images:
            assert isinstance(upload, UploadFile)
            data = await upload.read(MAX_IMAGE_BYTES + 1)
            validated.append(
                await asyncio.to_thread(
                    validate_image, upload.filename or "Image", data
                )
            )
        await asyncio.to_thread(
            manager.submit_images, run_id, prompt_id, content, validated
        )
    finally:
        await form.close()
