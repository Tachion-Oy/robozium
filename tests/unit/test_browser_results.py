"""Every browser requires a successful, complete suite and clean teardown."""

import json

import pytest

from tests.support.browser import __main__ as browser_command
from tests.support.browser.results import evaluate


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


def test_success_requires_consistent_completed_report(tmp_path):
    directory = report(
        tmp_path,
        runner={"status": 0},
        completion={
            "status": "passed",
            "outcomes": {"expected": 2, "unexpected": 0, "flaky": 0, "skipped": 0},
        },
    )
    assert evaluate("success", directory)[0] == 0


def test_completed_test_failures_are_required(tmp_path):
    directory = report(tmp_path)
    assert evaluate("failure", directory)[0] == 1


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
    assert evaluate("failure", directory)[0] == 1


def test_missing_completion_or_step_output_is_required(tmp_path):
    directory = report(tmp_path)
    (tmp_path / "completion.json").unlink()
    assert evaluate("failure", directory)[0] == 1
    assert evaluate("failure", "")[0] == 1
    assert evaluate("cancelled", directory)[0] == 1


def test_browser_fixture_cleanup_failure_is_required(tmp_path):
    directory = report(tmp_path)
    (tmp_path / "fixture-errors.log").write_text("cleanup: cancelled request\n")
    assert evaluate("failure", directory)[0] == 1


@pytest.mark.parametrize("statuses", [(0, 0), (1, 0), (0, 1)])
def test_browser_command_preserves_any_selected_browser_failure(
    tmp_path, monkeypatch, statuses
):
    commands = []
    monkeypatch.setattr(browser_command, "ROOT", tmp_path)

    def build(env, directory):
        directory.mkdir(parents=True)

    def run(args, directory, env):
        status = statuses[len(commands)]
        commands.append(args)
        completion = (
            {"status": "passed", "outcomes": {"expected": 2, "unexpected": 0}}
            if status == 0
            else {}
        )
        report(directory, runner={"status": status}, completion=completion)
        return status

    monkeypatch.setattr(browser_command, "build_frontend", build)
    monkeypatch.setattr(browser_command, "run_browser", run)
    status = browser_command.main(
        ["--project=chromium", "--browser=firefox", "--playwright-arg=--grep=history"]
    )
    assert status == int(any(statuses))
    assert commands == [
        ["--project=chromium", "--grep=history"],
        ["--project=firefox", "--grep=history"],
    ]
