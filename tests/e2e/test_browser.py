"""Run the production frontend against an isolated mock backend."""

from tests.e2e.policy import evaluate


def test_browser_suite(browser, browser_run, request):
    status, reports = browser_run(
        [f"--project={browser}", *request.config.getoption("playwright_arg")]
    )
    required, message = evaluate("success" if status == 0 else "failure", str(reports))
    assert not required, f"{browser}: {message}; reports: {reports}"
