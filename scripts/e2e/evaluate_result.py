"""Classify completed browser tests separately from runner failures."""

import json
import os
from pathlib import Path


def evaluate(browser: str, outcome: str, report_dir: str) -> tuple[int, str]:
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
    if not isinstance(outcomes, dict) or sum(outcomes.values()) != completion.get(
        "total"
    ):
        return 1, "required invalid test totals"
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
        if browser == "webkit":
            return (
                0,
                f"advisory: {failed} completed test failure(s); inspect the browser artifact",
            )
        return 1, f"required: {failed} test failure(s)"
    return 1, "required inconsistent or incomplete browser result"


def main() -> int:
    browser = os.environ["BROWSER"]
    status, message = evaluate(
        browser, os.environ["TEST_OUTCOME"], os.environ.get("REPORT_DIR", "")
    )
    summary = f"{browser} / {os.environ['SUITE']}: {message}"
    print(summary)
    if status:
        print(f"::error::{summary}")
    elif message != "passed":
        print(f"::warning::{summary}")
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as output:
            output.write(f"- {summary}\n")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
