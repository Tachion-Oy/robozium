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
PROBE = ROOT / "web/e2e/runner-probe.spec.ts"
PROBE_SOURCE = """import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

test('probe ordinary failure', () => expect(1).toBe(2))
test('probe flaky', ({}, info) => expect(info.retry).toBeGreaterThan(0))
for (let index = 0; index < 3; index++) {
  test(`probe failure ${index}`, () => expect(1).toBe(2))
}
test('probe passing', () => expect(1).toBe(1))
test('probe sleeping', async () => {
  await new Promise((resolve) => setTimeout(resolve, 10_000))
})
test('probe service exit', async () => {
  fs.writeFileSync(path.join(process.env.ROBOZIUM_E2E_CONTROL_DIR!, 'kill-backend.request'), '')
  await new Promise((resolve) => setTimeout(resolve, 10_000))
})
"""


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def user_files() -> dict[str, str]:
    paths = [ROOT / "hub.config.py", *sorted((ROOT / ".runtime").rglob("*"))]
    return {
        str(path): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in paths
        if path.is_file()
    }


def main() -> None:
    before = user_files()
    base = os.environ | {
        "ROBOZIUM_E2E_PREBUILT": "1",
        "ROBOZIUM_E2E_RUNNER_PROBE": "1",
        "CI": "1",
    }
    if PROBE.exists():
        raise FileExistsError(PROBE)
    PROBE.write_text(PROBE_SOURCE)
    try:
        for case in (
            "occupied-api",
            "occupied-web",
            "startup",
            "failed-tests",
            "flaky-retry",
            "failure-limit",
            "suite-timeout",
            "runner-deadline",
            "service-exit",
            "interruption",
            "cleanup-failure",
        ):
            check_case(case, base)
    finally:
        PROBE.unlink()
    assert user_files() == before, "User config or runtime data was altered"


def check_case(case: str, base: dict[str, str]) -> None:
    api_port, web_port = free_port(), free_port()
    while api_port == web_port:
        web_port = free_port()
    env = base | {
        "ROBOZIUM_E2E_API_PORT": str(api_port),
        "ROBOZIUM_E2E_WEB_PORT": str(web_port),
    }
    occupied = None
    if case.startswith("occupied"):
        occupied = socket.socket()
        occupied.bind(("127.0.0.1", api_port if case == "occupied-api" else web_port))
        occupied.listen()
    if case == "startup":
        env["ROBOZIUM_API_READY_TIMEOUT_SECONDS"] = "0"
    if case == "runner-deadline":
        env["ROBOZIUM_E2E_DEADLINE_SECONDS"] = "1"
    if case == "cleanup-failure":
        env["ROBOZIUM_E2E_PROBE_CLEANUP_FAILURE"] = "1"
    pattern = {
        "failed-tests": "probe ordinary failure",
        "flaky-retry": "probe flaky",
        "failure-limit": "probe failure|probe passing",
        "suite-timeout": "probe sleeping",
        "runner-deadline": "probe sleeping",
        "service-exit": "probe service exit",
        "interruption": "probe sleeping",
    }.get(case, "probe passing")
    args = [
        "--project=chromium",
        "e2e/runner-probe.spec.ts",
        f"--grep={pattern}",
        "--retries=0",
    ]
    if case == "flaky-retry":
        args[-1] = "--retries=1"
    if case == "failure-limit":
        args.append("--max-failures=3")
    if case == "suite-timeout":
        args.append("--global-timeout=1000")
    with (
        tempfile.TemporaryFile(mode="w+") as log,
        tempfile.NamedTemporaryFile(mode="r+") as output,
    ):
        env["GITHUB_OUTPUT"] = output.name
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
                    assert process.poll() is None, "Runner exited before interruption"
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
        output.seek(0)
        assert "report_dir=" in output.read(), case
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
        assert (result["runner_error"] is None) == (
            case
            in {
                "failed-tests",
                "flaky-retry",
                "failure-limit",
                "suite-timeout",
                "cleanup-failure",
            }
        ), (case, result)
        if case == "runner-deadline":
            assert result["deadline_reached"], result
        if case == "cleanup-failure":
            assert result["cleanup_errors"], result
        if case == "failure-limit":
            completion = json.loads((report / "completion.json").read_text())
            assert completion["failure_limit_reached"], completion
        if case == "flaky-retry":
            completion = json.loads((report / "completion.json").read_text())
            assert completion["outcomes"]["flaky"] == 1, completion
        if case == "suite-timeout":
            completion = json.loads((report / "completion.json").read_text())
            assert completion["status"] == "timedout", completion
        assert not Path(result["workspace"]).exists(), result
        assert all(row["returncode"] is not None for row in result["processes"]), result
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
        assert (report / "result.json").exists(), case
        if case not in {"occupied-api", "occupied-web", "startup"}:
            assert (report / "playwright.log").exists(), case
        evaluator = subprocess.run(
            [sys.executable, str(ROOT / "scripts/e2e/evaluate_result.py")],
            env=env
            | {
                "BROWSER": "webkit",
                "SUITE": "probe",
                "TEST_OUTCOME": "failure",
                "REPORT_DIR": str(report),
            },
            capture_output=True,
            text=True,
        )
        assert evaluator.returncode == (0 if case == "failed-tests" else 1), (
            case,
            evaluator.stdout,
            evaluator.stderr,
        )
        print(
            f"PASS {case}: result classified, diagnostics retained, workspace removed, services stopped"
        )


if __name__ == "__main__":
    main()
