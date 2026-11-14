"""Keep every test, and every process a test starts, away from a real hub."""

import pytest

from robozium.hub import environment as env


@pytest.fixture(autouse=True)
def temporary_hub(tmp_path_factory, monkeypatch):
    # Absent like a hub not yet created, which some tests check stays so.
    root = tmp_path_factory.mktemp("hub") / "root"
    monkeypatch.setenv(env.HUB_ROOT, str(root))
    monkeypatch.setenv(env.TOOL_DATA_DIR, str(root / "tool-data"))
