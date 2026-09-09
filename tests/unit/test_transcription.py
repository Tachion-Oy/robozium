"""Hub transcription route behavior."""

from __future__ import annotations

import importlib
from dataclasses import replace
from pathlib import Path

import pytest
from config_support import write_config
from fastapi.testclient import TestClient
from roboz.llm import MockTranscriptionEndpoint

from robosprawl.api.app import create_app
from robosprawl.hub.application import Hub
from robosprawl.hub.utils import load_hub

app_module = importlib.import_module("robosprawl.api.app")


def _deployment(transcription_endpoint, config_start: Path) -> Hub:
    return replace(
        load_hub(start=config_start),
        transcription_endpoint=transcription_endpoint,
    )


@pytest.fixture(autouse=True)
def _isolated_hub_config(tmp_path: Path) -> None:
    write_config(tmp_path)


def test_live_transcription_returns_clear_service_unavailable(tmp_path: Path) -> None:
    assert load_hub(start=tmp_path).transcription_endpoint is None
    client = TestClient(create_app(deployment=_deployment(None, tmp_path)))
    response = client.post(
        "/transcribe", files={"file": ("clip.webm", b"audio", "audio/webm")}
    )
    assert response.status_code == 503
    assert response.json() == {
        "detail": "Live transcription is not available in RoboSprawl."
    }


def test_transcribe_route_returns_text(tmp_path: Path) -> None:
    application = create_app(
        deployment=_deployment(
            MockTranscriptionEndpoint(["dictated command"]), tmp_path
        ),
    )
    client = TestClient(application)

    response = client.post(
        "/transcribe",
        files={"file": ("clip.webm", b"fake-audio", "audio/webm")},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "dictated command"}


def test_transcribe_route_accepts_codec_parameter(tmp_path: Path) -> None:
    # Chrome's MediaRecorder labels the upload "audio/webm;codecs=opus"; the
    # codec parameter must not trip the bare-type allowlist.
    application = create_app(
        deployment=_deployment(
            MockTranscriptionEndpoint(["dictated command"]), tmp_path
        ),
    )
    client = TestClient(application)

    response = client.post(
        "/transcribe",
        files={"file": ("clip.webm", b"fake-audio", "audio/webm;codecs=opus")},
    )

    assert response.status_code == 200
    assert response.json() == {"text": "dictated command"}


def test_transcribe_route_maps_provider_error_to_502(tmp_path: Path) -> None:
    application = create_app(
        deployment=_deployment(MockTranscriptionEndpoint([]), tmp_path),
    )
    client = TestClient(application)

    response = client.post(
        "/transcribe",
        files={"file": ("clip.webm", b"fake-audio", "audio/webm")},
    )

    assert response.status_code == 502


def test_transcribe_route_rejects_unsupported_content_type(tmp_path: Path) -> None:
    application = create_app(
        deployment=_deployment(MockTranscriptionEndpoint(["unused"]), tmp_path),
    )
    client = TestClient(application)

    response = client.post(
        "/transcribe",
        files={"file": ("clip.txt", b"not-audio", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "unsupported audio content type"


def test_transcribe_route_rejects_oversized_upload(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(app_module, "MAX_TRANSCRIPTION_UPLOAD_BYTES", 4)
    application = create_app(
        deployment=_deployment(MockTranscriptionEndpoint(["unused"]), tmp_path),
    )
    client = TestClient(application)

    response = client.post(
        "/transcribe",
        files={"file": ("clip.webm", b"12345", "audio/webm")},
    )

    assert response.status_code == 413
    assert response.json()["detail"] == "audio upload too large"
