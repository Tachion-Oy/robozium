"""Repository dependencies must satisfy their installation contracts."""

import json
import os
import re
import subprocess
import tomllib
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("configured", [False, True])
def test_browser_launcher_preserves_the_configured_browser_path(tmp_path, configured):
    script = tmp_path / "scripts/env.sh"
    script.parent.mkdir()
    script.write_text((ROOT / "scripts/env.sh").read_text())
    env = dict(os.environ)
    env.pop("PLAYWRIGHT_BROWSERS_PATH", None)
    expected = tmp_path / ".artifacts/browsers"
    if configured:
        expected = tmp_path / "pinned-browsers"
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(expected)
    result = subprocess.run(
        [
            "bash",
            "-eu",
            "-c",
            'source "$1"; printf "%s" "$PLAYWRIGHT_BROWSERS_PATH"',
            "bash",
            str(script),
        ],
        env=env,
        capture_output=True,
        text=True,
        check=True,
        timeout=10,
    )
    assert result.stdout == str(expected)


def test_roboz_uses_an_exact_indexed_release():
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())
    lock = tomllib.loads((ROOT / "uv.lock").read_text())
    releases = [p for p in lock["package"] if p["name"] == "roboz"]
    assert len(releases) == 1
    release = releases[0]
    dependency = next(
        value
        for value in project["project"]["dependencies"]
        if value.startswith("roboz")
    )
    assert re.fullmatch(r"roboz==[^*<>=~;,\s]+", dependency)
    assert set(release["source"]) == {"registry"}
    assert release["source"]["registry"].rstrip("/") in {
        "https://pypi.org/simple",
        "https://test.pypi.org/simple",
    }
    assert release["wheels"], "Installed checks require a published wheel"


def test_playwright_container_matches_locked_browser_version() -> None:
    lock = json.loads((ROOT / "web/package-lock.json").read_text())
    packages = lock["packages"]
    versions = {
        packages[f"node_modules/{name}"]["version"]
        for name in ("@playwright/test", "playwright", "playwright-core")
    }
    assert len(versions) == 1, "Playwright packages must use the same version"
    image = re.search(
        r"^FROM mcr\.microsoft\.com/playwright:v([^\s]+)-noble@sha256:[a-f0-9]{64} AS verify$",
        (ROOT / "Dockerfile").read_text(),
        re.MULTILINE,
    )
    assert image is not None, "Docker verification needs a pinned Playwright image"
    workflow_image = re.search(
        r"image: mcr\.microsoft\.com/playwright:v([^\s]+)-noble@sha256:[a-f0-9]{64}",
        (ROOT / ".github/workflows/e2e-browser.yml").read_text(),
    )
    assert workflow_image is not None, "Browser CI needs a digest-pinned test environment"
    assert image.group(1) == workflow_image.group(1) == versions.pop(), (
        "Update the Playwright Docker image and npm lockfile together; "
        "mismatched versions cannot locate browser executables"
    )


def test_all_private_local_files_are_ignored():
    paths = [
        "local/__init__.py", "local/simpsons.py", "local/private.py",
        "local/tools/example/__init__.py", "local/skills/example/requirements.txt",
    ]
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", *paths], cwd=ROOT,
        capture_output=True, text=True, check=True,
    )
    assert result.stdout.splitlines() == paths
