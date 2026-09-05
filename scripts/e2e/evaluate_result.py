"""Keep completed WebKit test failures advisory; require runner success."""

import os
from pathlib import Path


def evaluate(browser: str, outcome: str, exit_code: str) -> tuple[int, str]:
    if outcome == "success" and exit_code == "0":
        return 0, "passed"
    if browser == "webkit" and outcome == "failure" and exit_code == "1":
        return 0, "advisory test failure; inspect the browser artifact"
    return 1, f"required failure (step={outcome}, Playwright exit={exit_code or 'missing'})"


def main() -> int:
    browser = os.environ["BROWSER"]
    status, message = evaluate(
        browser, os.environ["TEST_OUTCOME"], os.environ.get("PLAYWRIGHT_EXIT_CODE", "")
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
