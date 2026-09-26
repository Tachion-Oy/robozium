"""The framework dependency must remain an exact published release."""

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
