"""Repository dependencies must satisfy their installation contracts."""

import json
import re
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


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
        r"^FROM mcr\.microsoft\.com/playwright:v([^\s]+)-noble AS verify$",
        (ROOT / "Dockerfile").read_text(),
        re.MULTILINE,
    )
    assert image is not None, "Docker verification needs a pinned Playwright image"
    assert image.group(1) == versions.pop(), (
        "Update the Playwright Docker image and npm lockfile together; "
        "mismatched versions cannot locate browser executables"
    )
