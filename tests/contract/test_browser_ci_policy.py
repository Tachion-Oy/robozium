"""Browser failures must not hide required failures behind advisory WebKit."""

import importlib.util
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "evaluate_result", Path(__file__).parents[2] / "scripts/e2e/evaluate_result.py"
)
assert SPEC is not None and SPEC.loader is not None
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


@pytest.mark.parametrize("browser", ["chromium", "firefox", "webkit"])
@pytest.mark.parametrize(
    ("outcome", "exit_code"),
    [
        ("failure", ""),
        ("failure", "2"),
        ("failure", "-15"),
        ("cancelled", "1"),
        ("skipped", ""),
        ("success", ""),
        ("failure", "0"),
    ],
)
def test_runner_or_incomplete_results_are_required(browser, outcome, exit_code):
    assert POLICY.evaluate(browser, outcome, exit_code)[0] == 1


@pytest.mark.parametrize("browser", ["chromium", "firefox", "webkit"])
def test_completed_success_passes(browser):
    assert POLICY.evaluate(browser, "success", "0")[0] == 0


@pytest.mark.parametrize("browser", ["chromium", "firefox", "webkit"])
def test_only_webkit_test_failures_are_advisory(browser):
    assert POLICY.evaluate(browser, "failure", "1")[0] == (browser != "webkit")
