"""Keep every test, and every process a test starts, away from a real hub."""

import pytest

from robozium.hub import environment as env


@pytest.fixture(autouse=True)
def temporary_hub(tmp_path_factory, monkeypatch):
    # Absent like a hub not yet created, which some tests check stays so.
    monkeypatch.setenv(env.HUB_ROOT, str(tmp_path_factory.mktemp("hub") / "root"))
