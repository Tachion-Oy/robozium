"""The unlock endpoint loads synthetic keys without exposing password or values."""

import os

import pytest
from config_support import write_config
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from roboz.endpoints import (
    ENCRYPTED_NAMESPACE,
    encrypt_env,
    encrypt_env_values,
    load_secrets,
    serialize_env,
)

from robozium.api.app import create_app, live_app, mock_app
from robozium.api.credentials import credential_status
from robozium.hub.utils import load_hub


@pytest.fixture(autouse=True)
def isolate_synthetic_environment(monkeypatch):
    names = ("TEST_UNLOCK_FIRST_API_KEY", "TEST_UNLOCK_SECOND_API_KEY", "TEST_UNLOCK_EXTERNAL_API_KEY", "TEST_MAIL_PASSWORD", "TEST_GROQ_API_KEY", "TEST_ONLY_PASSWORD", "TEST_MAIL_HOST")
    for name in names:
        monkeypatch.delenv(name, raising=False)
        monkeypatch.delenv(name + "_ENCRYPTED", raising=False)


@pytest.mark.parametrize("mode", ["live", "mock"])
@pytest.mark.parametrize("source_kind", ["file", "environment"])
def test_unlock_encrypted_keys_and_guard_runs(tmp_path, monkeypatch, source_kind, mode):
    write_config(tmp_path)
    source = tmp_path / ".env"
    source.write_text(
        "TEST_UNLOCK_FIRST_API_KEY=first-synthetic\n"
        "TEST_UNLOCK_SECOND_API_KEY=second-synthetic\n"
        "TEST_UNLOCK_EXTERNAL_API_KEY=file-synthetic\n"
    )
    encrypted = encrypt_env(source, secret_names=[name for name in dotenv_values(source) if name != "TEST_MAIL_HOST"], password="test-password")
    source.unlink()
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(encrypted))
    monkeypatch.setenv("ROBOZIUM_MODE", mode)
    monkeypatch.delenv("TEST_UNLOCK_FIRST_API_KEY", raising=False)
    monkeypatch.delenv("TEST_UNLOCK_SECOND_API_KEY", raising=False)
    monkeypatch.setenv("TEST_UNLOCK_EXTERNAL_API_KEY", "external-synthetic")
    names = ("TEST_UNLOCK_FIRST_API_KEY", "TEST_UNLOCK_SECOND_API_KEY")
    if source_kind == "environment":
        values = dotenv_values(encrypted, interpolate=False)
        for name in names:
            monkeypatch.setenv(name + "_ENCRYPTED", values[name + "_ENCRYPTED"])
        encrypted.unlink()
    original = {name: os.environ.get(name) for name in names}
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))

    status = client.get("/credentials")
    assert status.json() == {"available": True, "locked": True, "removable": False, "setup_required": False}
    assert status.headers["cache-control"] == "no-store"
    blocked = [
        client.post("/run/create", json={"project": "demo"}),
        client.post("/run/unknown/reply", json={"content": "hello"}),
        client.get("/run/unknown/stream"),
        client.post("/transcribe"),
    ]
    assert all(response.status_code == 423 for response in blocked)
    assert all(
        response.json()["detail"] == "Unlock secrets before using providers"
        for response in blocked
    )
    assert client.get("/run/unknown").status_code == 404
    assert (
        client.post("/credentials/unlock", json={"password": "wrong"}).status_code
        == 400
    )
    assert os.environ.get("TEST_UNLOCK_FIRST_API_KEY") == original["TEST_UNLOCK_FIRST_API_KEY"]
    assert os.environ.get("TEST_UNLOCK_SECOND_API_KEY") == original["TEST_UNLOCK_SECOND_API_KEY"]
    assert os.environ["TEST_UNLOCK_EXTERNAL_API_KEY"] == "external-synthetic"

    response = client.post("/credentials/unlock", json={"password": "test-password"})
    assert response.status_code == 200
    assert response.json() == {"available": True, "locked": False, "removable": True, "setup_required": False}
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
    assert cleared.json() == {"available": True, "locked": True, "removable": False, "setup_required": False}
    assert os.environ.get("TEST_UNLOCK_FIRST_API_KEY") == original["TEST_UNLOCK_FIRST_API_KEY"]
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
        assert cleared.json() == {"available": True, "locked": True, "removable": False, "setup_required": False}
    assert cleared.headers["cache-control"] == "no-store"
    assert os.environ.get("TEST_UNLOCK_FIRST_API_KEY") == original["TEST_UNLOCK_FIRST_API_KEY"]
    assert os.environ.get("TEST_UNLOCK_SECOND_API_KEY") == original["TEST_UNLOCK_SECOND_API_KEY"]
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
        "setup_required": False,
    }
    assert client.post("/credentials/clear").status_code == 200
    assert os.environ["TEST_PLAINTEXT_API_KEY"] == "synthetic"


def test_empty_selected_secret_can_be_unlocked_and_cleared(tmp_path, monkeypatch):
    write_config(tmp_path)
    source = tmp_path / ".env"
    source.write_text("TEST_ONLY_PASSWORD=\n")
    encrypted = encrypt_env(source, secret_names=["TEST_ONLY_PASSWORD"], password="synthetic-password")
    source.unlink()
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(encrypted))
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    response = client.post("/credentials/unlock", json={"password": "synthetic-password"})
    assert response.json() == {"available": True, "locked": False, "removable": True, "setup_required": False}
    assert os.environ["TEST_ONLY_PASSWORD"] == ""
    assert client.post("/credentials/clear").json()["locked"] is True
    assert "TEST_ONLY_PASSWORD" not in os.environ


def test_selected_secrets_are_encrypted_and_loaded_with_api_keys(tmp_path, monkeypatch):
    source = tmp_path / ".env"
    source.write_text(
        "TEST_MAIL_PASSWORD=mail-synthetic\n"
        "TEST_GROQ_API_KEY=groq-synthetic\n"
        "TEST_MAIL_HOST=mail.example\n"
    )
    encrypted = encrypt_env(source, secret_names=[name for name in dotenv_values(source) if name != "TEST_MAIL_HOST"], password="test-password")
    assert source.read_text().startswith("TEST_MAIL_PASSWORD=mail-synthetic")
    assert "mail-synthetic" not in encrypted.read_text()
    assert "groq-synthetic" not in encrypted.read_text()
    values = dotenv_values(encrypted, interpolate=False)
    assert values["TEST_MAIL_PASSWORD_ENCRYPTED"].startswith(ENCRYPTED_NAMESPACE)
    assert values["TEST_GROQ_API_KEY_ENCRYPTED"].startswith(ENCRYPTED_NAMESPACE)
    assert values["TEST_MAIL_HOST"] == "mail.example"

    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(encrypted))
    monkeypatch.setenv("ROBOZIUM_MODE", "live")
    monkeypatch.delenv("TEST_MAIL_PASSWORD", raising=False)
    monkeypatch.setenv("TEST_GROQ_API_KEY_ENCRYPTED", values["TEST_GROQ_API_KEY_ENCRYPTED"])
    assert credential_status().locked is True
    load_secrets(encrypted, password="test-password")
    assert os.environ["TEST_MAIL_PASSWORD"] == "mail-synthetic"
    assert os.environ["TEST_GROQ_API_KEY"] == "groq-synthetic"
    assert credential_status().locked is False

    monkeypatch.delenv("TEST_MAIL_PASSWORD")
    monkeypatch.delenv("TEST_GROQ_API_KEY")
    assert "TEST_MAIL_PASSWORD" not in os.environ
    assert "TEST_GROQ_API_KEY" not in os.environ
    assert credential_status().locked is True


def test_secret_only_file_requires_password_before_loading(tmp_path, monkeypatch):
    source = tmp_path / ".env"
    source.write_text("TEST_ONLY_PASSWORD=synthetic\n")
    encrypted = encrypt_env(source, secret_names=["TEST_ONLY_PASSWORD"], password="correct")
    monkeypatch.setenv("ROBOZIUM_MODE", "live")
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(encrypted))
    monkeypatch.delenv("TEST_ONLY_PASSWORD", raising=False)
    assert credential_status().locked is True
    with pytest.raises(ValueError):
        load_secrets(encrypted, password="wrong")
    assert "TEST_ONLY_PASSWORD" not in os.environ
    load_secrets(encrypted, password="correct")
    assert os.environ["TEST_ONLY_PASSWORD"] == "synthetic"


def test_without_encrypted_file_hides_unlock(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_MODE", "mock")
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / "missing"))
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    assert client.get("/credentials").json() == {
        "available": False,
        "locked": False,
        "removable": False,
        "setup_required": False,
    }
    assert client.post("/credentials/unlock", json={"password": "x"}).status_code == 404


@pytest.mark.parametrize(
    ("files", "require_credentials", "expected"),
    [
        ((), True, True),
        ((".env",), True, False),
        ((".env.encrypt",), True, False),
        ((), False, False),
    ],
)
def test_live_start_without_environment_files_requires_setup(
    tmp_path, monkeypatch, files, require_credentials, expected
):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    for name in files:
        (tmp_path / name).write_text("")
    client = TestClient(
        create_app(
            deployment=load_hub(start=tmp_path),
            require_credentials=require_credentials,
        )
    )

    assert client.get("/credentials").json()["setup_required"] is expected
    created = client.post("/run/create", json={"project": "demo"})
    assert (created.status_code == 423) is expected
    if expected:
        assert created.json() == {"detail": "Add API keys before using providers"}


@pytest.mark.parametrize(("factory", "expected"), [(live_app, True), (mock_app, False)])
def test_only_live_mode_requires_setup(tmp_path, monkeypatch, factory, expected):
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    client = TestClient(factory())
    assert client.get("/credentials").json()["setup_required"] is expected


def save_groq_key(client, *, secret=True):
    return client.post(
        "/credentials/environment",
        json={
            "revision": client.get("/credentials/environment").json()["revision"],
            "entries": [{"name": "TEST_GROQ_API_KEY", "value": "groq-synthetic", "secret": secret}],
            "password": "test-password" if secret else None,
        },
    )


@pytest.mark.parametrize("secret", [True, False])
def test_first_setup_save_loads_keys_without_restart(tmp_path, monkeypatch, secret):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    client = TestClient(
        create_app(deployment=load_hub(start=tmp_path), require_credentials=True)
    )

    saved = save_groq_key(client, secret=secret)

    assert saved.status_code == 200, saved.text
    assert os.environ["TEST_GROQ_API_KEY"] == "groq-synthetic"
    assert client.get("/credentials").json() == {
        "available": secret,
        "locked": False,
        "removable": secret,
        "setup_required": False,
    }
    assert client.post("/run/create", json={"project": "demo"}).status_code != 423
    # Clearing forgets keys this process loaded, as after an unlock.
    assert client.post("/credentials/clear").status_code == 200
    assert ("TEST_GROQ_API_KEY" in os.environ) is not secret


def test_first_setup_key_file_loads_keys_without_restart(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    client = TestClient(
        create_app(deployment=load_hub(start=tmp_path), require_credentials=True)
    )
    content = serialize_env(
        encrypt_env_values(
            {"TEST_GROQ_API_KEY": "groq-synthetic"},
            secret_names={"TEST_GROQ_API_KEY"},
            password="test-password",
        )
    ).encode()

    adopted = client.post(
        "/credentials/environment/file",
        data={
            "revision": client.get("/credentials/environment").json()["revision"],
            "password": "test-password",
        },
        files={"file": (".env.encrypt", content, "application/octet-stream")},
    )

    assert adopted.json() == {"status": "replaced", "loaded": True}, adopted.text
    assert os.environ["TEST_GROQ_API_KEY"] == "groq-synthetic"
    assert client.get("/credentials").json() == {
        "available": True,
        "locked": False,
        "removable": True,
        "setup_required": False,
    }
    assert client.post("/run/create", json={"project": "demo"}).status_code != 423


def test_later_saves_apply_after_restart(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))

    assert save_groq_key(client).status_code == 200
    assert "TEST_GROQ_API_KEY" not in os.environ
