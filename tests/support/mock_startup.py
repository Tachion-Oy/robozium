"""Exercise mock application startup in a separate Python process."""

import os
import subprocess
import sys
from pathlib import Path


def check_mock_startup(config_file: Path) -> None:
    """Check mock startup without constructing the provider-backed deployment."""
    config_file = config_file.resolve(strict=True)
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
import robozium.hub.application as application

def reject(*args, **kwargs):
    raise AssertionError('live deployment constructed')
application.robozium = reject
from robozium.api.app import mock_app
from fastapi.testclient import TestClient
with TestClient(mock_app()) as client:
    assert client.get('/ready').status_code == 200
    import logging
    from robozium.hub.utils import load_hub
    assert any(getattr(handler, "baseFilename", None) == str(load_hub().logging.path) for handler in logging.getLogger("robozium").handlers)
    records = client.get('/admin/dependencies').json()
    assert {row['dependency_id'] for row in records if row['kind'] == 'model_endpoint'} == {model['model_id'] for model in client.get('/models').json()['models']}
""",
        ],
        env={
            key: value
            for key, value in os.environ.items()
            if not key.endswith("_API_KEY_SECRET")
            and key
            not in {
                "ROBOZIUM_CONFIG",
                "ROBOZIUM_HUB_ROOT",
                "ROBOZIUM_LOG_DIR",
                "ROBOZIUM_HOST_SCRIPT_SOCKET",
            }
        }
        | {"ROBOZIUM_CONFIG": str(config_file)},
        cwd=config_file.parent,
        check=True,
        timeout=30,
    )
