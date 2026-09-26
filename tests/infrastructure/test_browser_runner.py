"""Real service failures and cancellation must release ports and temporary data."""

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

import pytest

from tests.support.browser import services
from tests.support.browser.results import evaluate
from tests.support.processes import free_port, stop


@pytest.fixture
def probe_env(tmp_path):
    api_port, web_port = free_port(), free_port()
    while api_port == web_port:
        web_port = free_port()
    config = tmp_path / "hub.config.py"
    original = "raise AssertionError('The E2E run must not load user configuration')\n"
    config.write_text(original)
    yield os.environ | {
        "ROBOZIUM_E2E_RUNNER_PROBE": "1",
        "CI": "1",
        "ROBOZIUM_E2E_API_PORT": str(api_port),
        "ROBOZIUM_E2E_WEB_PORT": str(web_port),
        "ROBOZIUM_E2E_PYTHON": os.environ.get("ROBOZIUM_E2E_PYTHON", sys.executable),
        "ROBOZIUM_E2E_DEADLINE_SECONDS": "60",
        "ROBOZIUM_CONFIG": str(config),
    }
    assert config.read_text() == original


def assert_cleaned(reports, env):
    result = json.loads((reports / "result.json").read_text())
    assert not Path(result["workspace"]).exists(), result
    for process in result["processes"]:
        assert process["returncode"] is not None, result
        with pytest.raises(ProcessLookupError):
            os.kill(process["pid"], 0)
    for name in ("ROBOZIUM_E2E_API_PORT", "ROBOZIUM_E2E_WEB_PORT"):
        with socket.socket() as probe:
            assert probe.connect_ex(("127.0.0.1", int(env[name]))) != 0
    return result


@pytest.mark.parametrize(
    "case",
    [
        "passing",
        "occupied-api",
        "occupied-web",
        "startup",
        "failed-tests",
        "flaky-retry",
        "failure-limit",
        "suite-timeout",
        "runner-deadline",
        "service-exit",
    ],
)
def test_lifecycle(case, browser_run, probe_env):
    env = probe_env.copy()
    pattern = {
        "failed-tests": "probe ordinary failure",
        "flaky-retry": "probe flaky",
        "failure-limit": "probe failure|probe passing",
        "suite-timeout": "probe sleeping",
        "runner-deadline": "probe sleeping",
        "service-exit": "probe service exit",
    }.get(case, "probe passing")
    args = [
        "--project=chromium",
        "runner-probe.spec.ts",
        f"--grep={pattern}",
        "--retries=1" if case == "flaky-retry" else "--retries=0",
    ]
    if case == "failure-limit":
        args.append("--max-failures=3")
    if case == "suite-timeout":
        args.append("--global-timeout=1000")
    if case == "startup":
        env["ROBOZIUM_API_READY_TIMEOUT_SECONDS"] = "0"
    if case == "runner-deadline":
        env["ROBOZIUM_E2E_DEADLINE_SECONDS"] = "1"
    occupied = socket.socket()
    try:
        if case.startswith("occupied"):
            port = env[
                "ROBOZIUM_E2E_API_PORT"
                if case == "occupied-api"
                else "ROBOZIUM_E2E_WEB_PORT"
            ]
            occupied.bind(("127.0.0.1", int(port)))
            occupied.listen()
        status, reports = browser_run(args, env)
    finally:
        occupied.close()
    assert (status == 0) == (case == "passing")
    result = assert_cleaned(reports, env)
    assert (result["runner_error"] is None) == (
        case
        in {
            "passing",
            "failed-tests",
            "flaky-retry",
            "failure-limit",
            "suite-timeout",
        }
    )
    required, _ = evaluate("success" if status == 0 else "failure", str(reports))
    assert required == (case != "passing")
    if case == "runner-deadline":
        assert result["deadline_reached"]


def test_cleanup_failure_is_required_and_other_services_still_stop(
    browser_run, probe_env, monkeypatch
):
    def failed_stop(process, *, crash=False):
        stop(process, crash=crash)
        if process.args[0] == "node" and "@playwright/test/cli.js" in process.args[1]:
            raise OSError("cleanup boundary failed")

    monkeypatch.setattr(services, "stop", failed_stop)
    status, reports = browser_run(
        ["--project=chromium", "runner-probe.spec.ts", "--grep=probe passing"],
        probe_env,
    )
    assert status == 1
    result = assert_cleaned(reports, probe_env)
    assert result["cleanup_errors"]
    assert evaluate("failure", str(reports))[0] == 1


def test_sigterm_cleans_services_and_keeps_diagnostics(
    frontend_build, probe_env, tmp_path
):
    env = probe_env | {"ROBOZIUM_E2E_PREBUILT": "1"}
    log_path = tmp_path / "interruption.log"
    with log_path.open("w") as log:
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tests.support.browser",
                "--playwright-arg=runner-probe.spec.ts",
                "--playwright-arg=--grep=probe sleeping",
                "--playwright-arg=--retries=0",
            ],
            cwd=services.ROOT,
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            deadline = time.monotonic() + 60
            while "Services ready" not in log_path.read_text():
                assert process.poll() is None, log_path.read_text()
                assert time.monotonic() < deadline, log_path.read_text()
                time.sleep(0.1)
            process.send_signal(signal.SIGTERM)
            assert process.wait(timeout=30) != 0
        finally:
            stop(process)
    text = log_path.read_text()
    assert text.count("E2E diagnostics: ") == 1, "Cancellation must stop later browsers"
    reports = Path(text.split("E2E diagnostics: ", 1)[1].splitlines()[0])
    result = assert_cleaned(reports, env)
    assert "KeyboardInterrupt" in result["runner_error"]
    assert evaluate("failure", str(reports))[0] == 1
