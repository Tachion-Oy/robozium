"""Repository dependencies must satisfy their installation contracts."""

import re
import subprocess
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
