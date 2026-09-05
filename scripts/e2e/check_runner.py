"""Exercise real runner failure paths after installing the backend and web build."""

import hashlib
import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def user_files() -> dict[str, str]:
    paths = [ROOT / "hub.config.json", *sorted((ROOT / ".runtime").rglob("*"))]
    return {
        str(path): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in paths
        if path.is_file()
    }


def main() -> None:
    before = user_files()
    base = os.environ | {"ROBOSPRAWL_E2E_PREBUILT": "1"}
    for case in (
        "occupied-api",
        "occupied-web",
        "startup",
        "failed-tests",
        "interruption",
    ):
        api_port, web_port = free_port(), free_port()
        while api_port == web_port:
            web_port = free_port()
        env = base | {
            "ROBOSPRAWL_E2E_API_PORT": str(api_port),
            "ROBOSPRAWL_E2E_WEB_PORT": str(web_port),
        }
        occupied = None
        if case.startswith("occupied"):
            occupied = socket.socket()
            occupied.bind(
                ("127.0.0.1", api_port if case == "occupied-api" else web_port)
            )
            occupied.listen()
        if case == "startup":
            env["ROBOSPRAWL_API_READY_TIMEOUT_SECONDS"] = "0"
        args = [
            "--project=chromium",
            "--grep=an unknown run keeps",
            "--timeout=1",
            "--retries=0",
        ]
        if case == "interruption":
            args = [
                "--project=chromium",
                "--repeat-each=100",
                "--grep=an unknown run keeps",
            ]
        with tempfile.TemporaryFile(mode="w+") as log:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "scripts/e2e/run.py"), *args],
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                if case == "interruption":
                    deadline = time.monotonic() + 60
                    while time.monotonic() < deadline:
                        log.seek(0)
                        if "Services ready" in log.read():
                            break
                        assert process.poll() is None, (
                            "Runner exited before interruption"
                        )
                        time.sleep(0.1)
                    else:
                        raise TimeoutError("Runner did not start browser")
                    process.send_signal(signal.SIGTERM)
                status = process.wait(timeout=90)
            finally:
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=30)
                if occupied:
                    occupied.close()
            assert status != 0, case
            log.seek(0)
            text = log.read()
            report = Path(
                next(
                    line.split(": ", 1)[1]
                    for line in text.splitlines()
                    if line.startswith("E2E diagnostics:")
                )
            )
            result = json.loads((report / "result.json").read_text())
            assert not Path(result["workspace"]).exists(), result
            assert all(row["returncode"] is not None for row in result["processes"]), (
                result
            )
            for row in result["processes"]:
                try:
                    os.kill(row["pid"], 0)
                except ProcessLookupError:
                    pass
                else:
                    raise AssertionError(f"Orphaned process: {row}")
            for port in (api_port, web_port):
                with socket.socket() as probe:
                    assert probe.connect_ex(("127.0.0.1", port)) != 0, (case, port)
            assert (
                report / ("playwright.log" if case == "failed-tests" else "failure.txt")
            ).exists(), case
            print(
                f"PASS {case}: diagnostics retained, workspace removed, services stopped"
            )
    assert user_files() == before, "User config or runtime data was altered"


if __name__ == "__main__":
    main()
