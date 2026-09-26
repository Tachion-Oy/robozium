"""Installed Robozium HTTP run/reply/completion contract; no service credentials."""

import json
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

import pytest

from tests.support.processes import free_port, ready, stop


@pytest.fixture
def api():
    base = f"http://127.0.0.1:{free_port()}"
    with Path("backend.log").open("w") as log:
        backend = subprocess.Popen(
            [
                sys.executable,
                "-I",
                "-m",
                "uvicorn",
                "robozium.api.app:mock_app",
                "--factory",
                "--host",
                "127.0.0.1",
                "--port",
                base.rsplit(":", 1)[1],
            ],
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            ready(backend, base + "/ready", 30)
            yield base
        finally:
            stop(backend)


def test_imports_come_from_the_installed_environment():
    import roboz
    import roboz.endpoints

    import robozium

    for module in (robozium, roboz):
        assert (
            Path(module.__file__).resolve().is_relative_to(Path(sys.prefix).resolve())
        )


def test_installed_http_run_reply_stream_and_persistence(api):
    def request(path: str, data: dict | None = None):
        req = urllib.request.Request(
            api + path,
            data=None if data is None else json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.load(response)

    request("/projects", {"name": "installed-contract"})
    run_id = request("/run/create", {"project": "installed-contract"})["run_id"]
    frames, errors = [], []

    def consume():
        try:
            with urllib.request.urlopen(
                api + f"/run/{run_id}/stream", timeout=30
            ) as response:
                for line in response:
                    frames.append(line.decode())
        except Exception as error:
            errors.append(error)

    stream = threading.Thread(target=consume, daemon=True)
    stream.start()
    answered = set()
    try:
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            state = request(f"/run/{run_id}")
            assert state["status"] not in {"failed", "cancelled"}, state
            if state["status"] == "completed":
                break
            if state["status"] == "awaiting_user_input":
                prompt = state["current_prompt_id"]
                if prompt not in answered:
                    assert request(
                        f"/run/{run_id}/reply", {"content": "Continue and finish."}
                    ) == {"ok": True}
                    answered.add(prompt)
            time.sleep(0.05)
        else:
            raise TimeoutError(f"Run did not complete: {state}")
        stream.join(timeout=5)
        assert not stream.is_alive() and not errors, errors
        assert len(answered) == 2, answered
        assert "Hello, World!" in "".join(frames)
        assert "completed" in "".join(frames)
        assert list(Path("hub_data/projects/installed-contract").rglob("*.json"))
    finally:
        stream.join(timeout=5)
