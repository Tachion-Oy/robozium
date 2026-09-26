"""Fixtures for tests of browser-runner startup, failure, and cleanup."""

import os
import sys
import tempfile
from pathlib import Path

import pytest

from tests.support.browser.services import ROOT, build_frontend, run_browser


@pytest.fixture(scope="session")
def frontend_build():
    build_frontend(dict(os.environ), ROOT / ".artifacts/e2e")


@pytest.fixture
def browser_run(frontend_build):
    root = ROOT / ".artifacts/e2e"
    root.mkdir(parents=True, exist_ok=True)
    reports = Path(tempfile.mkdtemp(prefix="run-", dir=root))

    def run(args, env):
        environment = env.copy()
        environment.setdefault("ROBOZIUM_E2E_PYTHON", sys.executable)
        return run_browser(args, reports, environment), reports

    return run
