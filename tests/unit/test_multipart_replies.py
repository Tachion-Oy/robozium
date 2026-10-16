"""Multipart parsing spools incrementally and releases partial uploads."""

import asyncio
from collections import deque

import pytest
import starlette.formparsers as forms
from fastapi import HTTPException, Request

from robozium.api.replies import _multipart


@pytest.mark.parametrize("ending", ["complete", "incomplete", "overflow", "disconnect", "cancelled"])
def test_streamed_multipart_spools_before_next_chunk_and_cleans_up(ending, monkeypatch):
    created = []
    original = forms.SpooledTemporaryFile

    def tracked(*args, **kwargs):
        spool = original(*args, **kwargs)
        created.append(spool)
        return spool

    monkeypatch.setattr(forms, "SpooledTemporaryFile", tracked)
    chunk = b"x" * (1024 * 1024)
    chunks = deque([
        b'--b\r\nContent-Disposition: form-data; name="images"; filename="a.png"\r\n\r\n',
        *([chunk] * (42 if ending == "overflow" else 40)),
    ])
    if ending == "complete":
        chunks.append(b"\r\n--b--\r\n")
    received = 0

    async def receive():
        nonlocal received
        # Parsing must have opened the file and consumed the previous chunk
        # before asking the ASGI server for more data.
        if chunks and received >= 2:
            assert created[0].tell() == (received - 1) * len(chunk)
        if chunks:
            received += 1
            return {"type": "http.request", "body": chunks.popleft(), "more_body": True}
        if ending == "disconnect":
            return {"type": "http.disconnect"}
        if ending == "cancelled":
            raise asyncio.CancelledError
        return {"type": "http.request", "body": b"", "more_body": False}

    request = Request({
        "type": "http",
        "headers": [(b"content-type", b"multipart/form-data; boundary=b")],
    }, receive)

    async def parse():
        if ending == "complete":
            form = await _multipart(request)
            try:
                assert form["images"].size == 40 * len(chunk)
            finally:
                await form.close()
        elif ending == "cancelled":
            with pytest.raises(asyncio.CancelledError):
                await _multipart(request)
        else:
            with pytest.raises(HTTPException) as error:
                await _multipart(request)
            assert error.value.status_code == (413 if ending == "overflow" else 400)

    asyncio.run(parse())
    assert created and all(spool.closed for spool in created)
