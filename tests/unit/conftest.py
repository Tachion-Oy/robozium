"""Keep default configuration discovery away from the user's checkout and hub."""

import pytest
from config_support import write_config


@pytest.fixture(autouse=True)
def isolated_default_config(tmp_path, monkeypatch):
    root = tmp_path / "default-config"
    root.mkdir()
    config = write_config(root, name="Robozium")
    monkeypatch.setenv("ROBOZIUM_CONFIG", str(config))
    for name in (
        "ROBOZIUM_HUB_ROOT",
        "ROBOZIUM_LOG_DIR",
        "ROBOZIUM_HOST_SCRIPT_SOCKET",
    ):
        monkeypatch.delenv(name, raising=False)
