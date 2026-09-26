"""Run the Playwright application suite with disposable services."""

import argparse
import os
import sys
import tempfile
from pathlib import Path

from tests.support.browser.results import evaluate
from tests.support.browser.services import ROOT, build_frontend, run_browser

BROWSERS = ("chromium", "firefox", "webkit")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", "--project", action="append", choices=BROWSERS)
    parser.add_argument(
        "--playwright-arg",
        action="append",
        default=[],
        help="Forward an argument to Playwright (use = for flags)",
    )
    options = parser.parse_args(argv)
    env = dict(os.environ)
    env.setdefault("ROBOZIUM_E2E_PYTHON", sys.executable)
    root = ROOT / ".artifacts/e2e"
    try:
        build_frontend(env, root)
        failed = False
        for browser in options.browser or BROWSERS:
            reports = Path(tempfile.mkdtemp(prefix="run-", dir=root))
            status = run_browser(
                [f"--project={browser}", *options.playwright_arg], reports, env
            )
            required, message = evaluate(
                "success" if status == 0 else "failure", str(reports)
            )
            print(f"{browser}: {message}; reports: {reports}", flush=True)
            failed |= bool(required)
        return int(failed)
    except KeyboardInterrupt:
        print("Browser run interrupted", file=sys.stderr)
        return 130
    except Exception as error:
        print(f"Browser run failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
