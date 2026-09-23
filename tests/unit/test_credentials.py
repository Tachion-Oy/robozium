"""The unlock endpoint loads synthetic keys without exposing password or values."""

import os

from config_support import write_config
from fastapi.testclient import TestClient
from roboz.endpoints import encrypt_env

from robozium.api.app import create_app
from robozium.hub.utils import load_hub


def test_unlock_encrypted_keys_and_guard_runs(tmp_path, monkeypatch):
    write_config(tmp_path)
    source = tmp_path / ".env"
    source.write_text(
        "TEST_UNLOCK_FIRST_API_KEY=first-synthetic\n"
        "TEST_UNLOCK_SECOND_API_KEY=second-synthetic\n"
        "TEST_UNLOCK_EXTERNAL_API_KEY=file-synthetic\n"
    )
    encrypted = encrypt_env(source, password="test-password")
    source.unlink()
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(encrypted))
    monkeypatch.setenv("ROBOZIUM_MODE", "live")
    monkeypatch.delenv("TEST_UNLOCK_FIRST_API_KEY", raising=False)
    monkeypatch.delenv("TEST_UNLOCK_SECOND_API_KEY", raising=False)
    monkeypatch.setenv("TEST_UNLOCK_EXTERNAL_API_KEY", "external-synthetic")
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))

    status = client.get("/credentials")
    assert status.json() == {"available": True, "locked": True, "removable": False}
    assert status.headers["cache-control"] == "no-store"
    blocked = [
        client.post("/run/create", json={"project": "demo"}),
        client.post("/run/unknown/reply", json={"content": "hello"}),
        client.get("/run/unknown/stream"),
        client.post("/transcribe"),
    ]
    assert all(response.status_code == 423 for response in blocked)
    assert all(
        response.json()["detail"] == "Unlock API keys before using providers"
        for response in blocked
    )
    assert client.get("/run/unknown").status_code == 404
    assert (
        client.post("/credentials/unlock", json={"password": "wrong"}).status_code
        == 400
    )
    assert "TEST_UNLOCK_FIRST_API_KEY" not in os.environ
    assert "TEST_UNLOCK_SECOND_API_KEY" not in os.environ
    assert os.environ["TEST_UNLOCK_EXTERNAL_API_KEY"] == "external-synthetic"

    response = client.post("/credentials/unlock", json={"password": "test-password"})
    assert response.status_code == 200
    assert response.json() == {"available": True, "locked": False, "removable": True}
    assert response.headers["cache-control"] == "no-store"
    assert "test-password" not in response.text
    assert "first-synthetic" not in response.text
    assert os.environ["TEST_UNLOCK_FIRST_API_KEY"] == "first-synthetic"
    assert os.environ["TEST_UNLOCK_SECOND_API_KEY"] == "second-synthetic"
    assert "ROBOZ_ENV_PASSWORD" not in os.environ
    assert client.get("/credentials").json()["locked"] is False
    assert client.post("/projects", json={"name": "demo"}).status_code == 200
    run_id = client.post("/run/create", json={"project": "demo"}).json()["run_id"]
    assert client.get("/credentials").json()["removable"] is True
    cleared = client.post("/credentials/clear")
    assert cleared.status_code == 200
    assert cleared.json() == {"available": True, "locked": True, "removable": False}
    assert "TEST_UNLOCK_FIRST_API_KEY" not in os.environ
    assert client.post("/run/create", json={"project": "demo"}).status_code == 423
    assert (
        client.post("/credentials/unlock", json={"password": "test-password"}).json()[
            "locked"
        ]
        is False
    )
    assert client.post("/projects/demo/cancel").status_code == 200
    assert client.get("/run/" + run_id).json()["status"] == "cancelled"
    control = client.app.state.run_manager._control(run_id)
    with monkeypatch.context() as patch:
        patch.setattr(control, "is_busy", lambda *, background_only=False: True)
        assert client.get("/credentials").json()["removable"] is True
        cleared = client.post("/credentials/clear")
        assert cleared.status_code == 200
        assert cleared.json() == {"available": True, "locked": True, "removable": False}
    assert cleared.headers["cache-control"] == "no-store"
    assert "TEST_UNLOCK_FIRST_API_KEY" not in os.environ
    assert "TEST_UNLOCK_SECOND_API_KEY" not in os.environ
    assert os.environ["TEST_UNLOCK_EXTERNAL_API_KEY"] == "external-synthetic"
    assert client.post("/run/create", json={"project": "demo"}).status_code == 423
    assert (
        client.post("/credentials/unlock", json={"password": "test-password"}).json()[
            "locked"
        ]
        is False
    )
    assert os.environ["TEST_UNLOCK_FIRST_API_KEY"] == "first-synthetic"


def test_plaintext_only_keys_never_offer_control(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_MODE", "live")
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / "missing"))
    monkeypatch.setenv("TEST_PLAINTEXT_API_KEY", "synthetic")
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    assert client.get("/credentials").json() == {
        "available": False,
        "locked": False,
        "removable": False,
    }
    assert client.post("/credentials/clear").status_code == 200
    assert os.environ["TEST_PLAINTEXT_API_KEY"] == "synthetic"


def test_mock_mode_never_offers_unlock(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_MODE", "mock")
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / "missing"))
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    assert client.get("/credentials").json() == {
        "available": False,
        "locked": False,
        "removable": False,
    }
    assert client.post("/credentials/unlock", json={"password": "x"}).status_code == 404
