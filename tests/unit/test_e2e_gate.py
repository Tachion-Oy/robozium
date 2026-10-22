"""The merge gate accepts only the expected result of every required job."""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = yaml.load(
    (ROOT / ".github/workflows/e2e.yml").read_text(), Loader=yaml.BaseLoader
)
WEB_JOBS = {"chromium", "firefox", "webkit", "installation", "runner"}
REQUIRED_JOBS = WEB_JOBS | {"scope", "docker", "electron", "package"}
RESULTS = ["success", "failure", "cancelled", "skipped", None]


def expected(web: bool) -> dict[str, dict[str, object]]:
    web_result = "success" if web else "skipped"
    return {
        name: {"result": web_result if name in WEB_JOBS else "success"}
        for name in REQUIRED_JOBS
    }


def check(results: dict[str, dict[str, object]], web: str) -> int:
    step = WORKFLOW["jobs"]["full-e2e"]["steps"][0]
    assert step["env"] == {
        "REQUIRED_RESULTS": "${{ toJSON(needs) }}",
        "WEB_AFFECTED": "${{ needs.scope.outputs.web }}",
    }
    command, script = step["run"].rstrip().split("\n", 1)
    assert command == "python3 - <<'PY'"
    script, delimiter = script.rsplit("\n", 1)
    assert delimiter == "PY"
    return subprocess.run(
        [sys.executable, "-c", script],
        env=os.environ | {"REQUIRED_RESULTS": json.dumps(results), "WEB_AFFECTED": web},
        capture_output=True,
        timeout=10,
    ).returncode


@pytest.mark.parametrize("web", [True, False])
def test_expected_results_pass(web):
    assert check(expected(web), "true" if web else "false") == 0


@pytest.mark.parametrize(
    ("web", "name", "result"),
    [
        (web, name, result)
        for web in (True, False)
        for name in sorted(REQUIRED_JOBS)
        for result in RESULTS
        if result != expected(web)[name]["result"]
    ],
)
def test_any_other_result_fails(web, name, result):
    results = expected(web)
    results[name] = {"result": result}
    assert check(results, "true" if web else "false") == 1


@pytest.mark.parametrize("web", [True, False])
@pytest.mark.parametrize("name", sorted(REQUIRED_JOBS))
def test_missing_job_fails(web, name):
    results = expected(web)
    results.pop(name)
    assert check(results, "true" if web else "false") == 1


def test_a_failed_scope_job_cannot_skip_web_jobs():
    # A failed scope job sets no output, so every web job is skipped.
    results = expected(False)
    results["scope"] = {"result": "failure"}
    assert check(results, "") == 1


def test_workflow_runs_web_jobs_unless_the_scope_job_excludes_them():
    workflow = WORKFLOW
    jobs = workflow["jobs"]
    aggregate = jobs["full-e2e"]
    assert aggregate["name"] == "Full E2E"
    assert aggregate["if"] == "${{ always() }}"
    assert set(aggregate["needs"]) == REQUIRED_JOBS == jobs.keys() - {"full-e2e"}
    assert set(workflow["on"]) == {"pull_request", "push", "workflow_dispatch"}
    assert workflow["on"]["push"]["branches"] == ["main"]
    assert workflow["permissions"] == {"contents": "read"}
    for name in WEB_JOBS:
        assert jobs[name]["needs"] == "scope"
        assert jobs[name]["if"] == "${{ needs.scope.outputs.web == 'true' }}"
    assert all("if" not in jobs[name] for name in REQUIRED_JOBS - WEB_JOBS)
    shared = yaml.load(
        (ROOT / ".github/workflows/e2e-browser.yml").read_text(), Loader=yaml.BaseLoader
    )
    for name in ("chromium", "firefox", "webkit"):
        assert jobs[name]["with"]["task"] == "suite"
        assert jobs[name]["with"]["browser"] == name
    assert jobs["installation"]["with"]["task"] == "installation"
    assert jobs["runner"]["with"]["task"] == "runner"
    assert shared["permissions"] == {"contents": "read"}


def scope(repo: Path, event: str, changed: list[str]) -> str:
    """Run the scope step on a base commit followed by a change to *changed*."""
    def git(*args: str) -> None:
        subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True)

    repo.mkdir()
    git("init", "-q")
    git("config", "user.email", "ci@example.invalid")
    git("config", "user.name", "CI")
    (repo / "base").write_text("base\n")
    git("add", "-A")
    git("commit", "-qm", "base")
    for path in changed:
        (repo / path).parent.mkdir(parents=True, exist_ok=True)
        (repo / path).write_text("change\n")
    git("add", "-A")
    git("commit", "-qm", "change")
    step = WORKFLOW["jobs"]["scope"]["steps"][1]
    output = repo.parent / "output"
    subprocess.run(
        ["bash", "-e", "-c", step["run"]],
        cwd=repo,
        env=os.environ | {"EVENT": event, "GITHUB_OUTPUT": str(output)},
        check=True,
        timeout=10,
    )
    return output.read_text().strip()


@pytest.mark.parametrize(
    ("event", "changed", "web"),
    [
        ("pull_request", ["desktop/src/main.ts"], "false"),
        ("pull_request", ["desktop/src/main.ts", "docs/testing.md", "CHANGELOG.md"], "false"),
        ("pull_request", ["desktop/src/main.ts", "web/app/page.tsx"], "true"),
        ("pull_request", ["src/robozium/api.py"], "true"),
        ("pull_request", [".github/workflows/e2e.yml", "docs/testing.md"], "true"),
        ("pull_request", ["desktopx/file"], "true"),
        ("pull_request", ["CHANGELOG.md.bak"], "true"),
        ("push", ["desktop/src/main.ts"], "true"),
        ("workflow_dispatch", ["desktop/src/main.ts"], "true"),
    ],
)
def test_scope_skips_web_jobs_only_for_desktop_and_docs_pull_requests(
    tmp_path, event, changed, web
):
    assert scope(tmp_path / "repo", event, changed) == f"web={web}"
