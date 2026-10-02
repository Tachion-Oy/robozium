"""Classify completed browser tests separately from runner failures."""

import json
from pathlib import Path


def evaluate(outcome: str, report_dir: str) -> tuple[int, str]:
    if outcome not in {"success", "failure"} or not report_dir:
        return 1, f"required failure (browser step={outcome}, report missing)"
    try:
        report = Path(report_dir)
        runner = json.loads((report / "result.json").read_text())
        completion = json.loads((report / "completion.json").read_text())
    except (OSError, ValueError) as error:
        return 1, f"required failure (completion report missing or invalid: {error})"

    if (
        runner.get("runner_error")
        or runner.get("deadline_reached")
        or runner.get("cleanup_errors")
    ):
        return 1, "required runner, deadline, or cleanup failure"
    if (report / "fixture-errors.log").exists():
        return 1, "required browser fixture setup or cleanup failure"
    if (
        completion.get("errors")
        or completion.get("stopped_early")
        or completion.get("failure_limit_reached")
    ):
        return 1, "required top-level error or early suite termination"
    if completion.get("status") in {"timedout", "interrupted"}:
        return 1, f"required suite {completion['status']}"
    outcomes = completion.get("outcomes", {})
    if (
        not isinstance(outcomes, dict)
        or set(outcomes) != {"expected", "unexpected", "flaky", "skipped"}
        or any(type(count) is not int or count < 0 for count in outcomes.values())
        or sum(outcomes.values()) != completion.get("total")
        or not completion.get("total")
    ):
        return 1, "required invalid test totals"
    expected_skipped = completion.get("expected_skipped", 0)
    if (
        type(expected_skipped) is not int
        or expected_skipped < 0
        or outcomes["skipped"] != expected_skipped
        or completion.get("started") != completion["total"] - expected_skipped
        or outcomes["expected"] == 0
    ):
        return 1, "required unexpected skips or incomplete test execution"
    if outcomes.get("flaky", 0):
        return 1, f"required: {outcomes['flaky']} flaky test(s)"
    failed = outcomes.get("unexpected", 0) + outcomes.get("flaky", 0)
    if (
        completion.get("status") == "passed"
        and failed == 0
        and runner.get("status") == 0
        and outcome == "success"
    ):
        return 0, "passed"
    if (
        completion.get("status") == "failed"
        and failed > 0
        and runner.get("status") == 1
        and outcome == "failure"
    ):
        return 1, f"required: {failed} test failure(s)"
    return 1, "required inconsistent or incomplete browser result"
