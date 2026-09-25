"""A WebKit exception applies only after the whole suite completes normally."""

import importlib.util
import json
from pathlib import Path

import pytest

SPEC = importlib.util.spec_from_file_location(
    "evaluate_result", Path(__file__).parents[2] / "scripts/e2e/evaluate_result.py"
)
assert SPEC is not None and SPEC.loader is not None
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


def report(tmp_path, *, runner=None, completion=None):
    runner_data = {
        "status": 1,
        "runner_error": None,
        "deadline_reached": False,
        "cleanup_errors": [],
    } | (runner or {})
    completion_data = {
        "status": "failed",
        "errors": [],
        "outcomes": {"expected": 1, "unexpected": 1, "flaky": 0, "skipped": 0},
        "total": 2,
        "stopped_early": False,
        "failure_limit_reached": False,
    } | (completion or {})
    (tmp_path / "result.json").write_text(json.dumps(runner_data))
    (tmp_path / "completion.json").write_text(json.dumps(completion_data))
    return str(tmp_path)


@pytest.mark.parametrize("browser", ["chromium", "firefox", "webkit"])
def test_success_requires_consistent_completed_report(tmp_path, browser):
    directory = report(
        tmp_path,
        runner={"status": 0},
        completion={
            "status": "passed",
            "outcomes": {"expected": 2, "unexpected": 0, "flaky": 0, "skipped": 0},
        },
    )
    assert POLICY.evaluate(browser, "success", directory)[0] == 0


@pytest.mark.parametrize("browser", ["chromium", "firefox", "webkit"])
def test_only_completed_webkit_failures_are_advisory(tmp_path, browser):
    directory = report(tmp_path)
    assert POLICY.evaluate(browser, "failure", directory)[0] == (browser != "webkit")


@pytest.mark.parametrize(
    ("runner", "completion"),
    [
        ({"runner_error": "service exited"}, {}),
        ({"runner_error": "interrupted"}, {"status": "interrupted"}),
        ({"deadline_reached": True}, {}),
        ({"cleanup_errors": ["stop failed"]}, {}),
        ({}, {"status": "timedout"}),
        ({}, {"errors": ["setup failed"]}),
        ({}, {"failure_limit_reached": True}),
        ({}, {"stopped_early": True}),
        ({}, {"outcomes": {"expected": 0, "unexpected": 0, "flaky": 2, "skipped": 0}}),
    ],
)
def test_incomplete_or_runner_failures_are_required(tmp_path, runner, completion):
    directory = report(tmp_path, runner=runner, completion=completion)
    assert POLICY.evaluate("webkit", "failure", directory)[0] == 1


def test_missing_completion_or_step_output_is_required(tmp_path):
    directory = report(tmp_path)
    (tmp_path / "completion.json").unlink()
    assert POLICY.evaluate("webkit", "failure", directory)[0] == 1
    assert POLICY.evaluate("webkit", "failure", "")[0] == 1
    assert POLICY.evaluate("webkit", "cancelled", directory)[0] == 1


def test_browser_fixture_cleanup_failure_is_required(tmp_path):
    directory = report(tmp_path)
    (tmp_path / "fixture-errors.log").write_text("cleanup: cancelled request\n")
    assert POLICY.evaluate("webkit", "failure", directory)[0] == 1
