"""The merge gate rejects any unsuccessful or missing required job."""

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
REQUIRED_JOBS = {"chromium", "firefox", "webkit", "installation", "runner", "docker"}


def check(results: dict[str, dict[str, object]]) -> int:
    step = WORKFLOW["jobs"]["full-e2e"]["steps"][0]
    assert step["env"] == {"REQUIRED_RESULTS": "${{ toJSON(needs) }}"}
    command, script = step["run"].rstrip().split("\n", 1)
    assert command == "python3 - <<'PY'"
    script, delimiter = script.rsplit("\n", 1)
    assert delimiter == "PY"
    return subprocess.run(
        [sys.executable, "-c", script],
        env=os.environ | {"REQUIRED_RESULTS": json.dumps(results)},
        capture_output=True,
        timeout=10,
    ).returncode


def test_complete_success_passes():
    assert check({name: {"result": "success"} for name in REQUIRED_JOBS}) == 0


@pytest.mark.parametrize("name", sorted(REQUIRED_JOBS))
@pytest.mark.parametrize("result", ["failure", "cancelled", "skipped", None])
def test_any_unsuccessful_job_fails(name, result):
    results = {name: {"result": "success"} for name in REQUIRED_JOBS}
    results[name] = {"result": result}
    assert check(results) == 1


def test_missing_job_fails():
    results = {name: {"result": "success"} for name in REQUIRED_JOBS}
    results.pop("webkit")
    assert check(results) == 1


def test_workflow_requires_the_complete_matrix_on_every_pr():
    workflow = WORKFLOW
    jobs = workflow["jobs"]
    aggregate = jobs["full-e2e"]
    assert aggregate["name"] == "Full E2E"
    assert aggregate["if"] == "${{ always() }}"
    assert set(aggregate["needs"]) == REQUIRED_JOBS == jobs.keys() - {"full-e2e"}
    assert set(workflow["on"]) == {"pull_request", "push", "workflow_dispatch"}
    assert workflow["on"]["push"]["branches"] == ["main"]
    assert workflow["permissions"] == {"contents": "read"}
    assert all("if" not in jobs[name] for name in REQUIRED_JOBS)
    shared = yaml.load(
        (ROOT / ".github/workflows/e2e-browser.yml").read_text(), Loader=yaml.BaseLoader
    )
    for name in ("chromium", "firefox", "webkit"):
        assert jobs[name]["with"]["task"] == "suite"
        assert jobs[name]["with"]["browser"] == name
    assert jobs["installation"]["with"]["task"] == "installation"
    assert jobs["runner"]["with"]["task"] == "runner"
    assert shared["permissions"] == {"contents": "read"}
