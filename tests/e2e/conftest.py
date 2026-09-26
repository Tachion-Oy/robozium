"""Explicit browser selection and production-build ownership for E2E tests."""

import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

from tests.e2e.services import ROOT, run_browser, termination_signals
from tests.support.processes import stop


def pytest_addoption(parser):
    parser.addoption(
        "--browser",
        "--project",
        action="append",
        choices=("chromium", "firefox", "webkit"),
    )
    parser.addoption(
        "--playwright-arg",
        action="append",
        default=[],
        help="Forward an argument to Playwright (use = for flags)",
    )


def pytest_generate_tests(metafunc):
    if "browser" in metafunc.fixturenames:
        metafunc.parametrize(
            "browser",
            metafunc.config.getoption("browser") or ["chromium", "firefox", "webkit"],
        )


@pytest.fixture(scope="session")
def frontend_build():
    if os.environ.get("ROBOZIUM_E2E_PREBUILT") == "1":
        assert (ROOT / "web/.next/BUILD_ID").is_file(), (
            "ROBOZIUM_E2E_PREBUILT requires a frontend build"
        )
        return
    reports = ROOT / ".artifacts/e2e"
    reports.mkdir(parents=True, exist_ok=True)
    with (reports / "build.log").open("w") as log, termination_signals():
        build = subprocess.Popen(
            ["npm", "run", "build"],
            cwd=ROOT / "web",
            env=os.environ
            | {
                "ROBOZIUM_API_BASE_URL": f"http://127.0.0.1:{os.environ.get('ROBOZIUM_E2E_API_PORT', '8000')}"
            },
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            assert build.wait(timeout=180) == 0, (
                f"Frontend build failed; inspect {log.name}"
            )
        finally:
            stop(build)


@pytest.fixture
def browser_run(frontend_build):
    root = ROOT / ".artifacts/e2e"
    root.mkdir(parents=True, exist_ok=True)
    # Keep reports after pytest removes the disposable workspace.
    reports = Path(tempfile.mkdtemp(prefix="run-", dir=root))

    def run(args, env=None):
        environment = dict(os.environ) if env is None else env.copy()
        environment.setdefault("ROBOZIUM_E2E_PYTHON", sys.executable)
        return run_browser(args, reports, environment), reports

    return run
