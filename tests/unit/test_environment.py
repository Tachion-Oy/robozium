"""Settings edits are validated, encrypted, and committed only when they apply."""

import os

import pytest
from config_support import write_config
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from roboz.endpoints import decrypt_env_values, encrypt_env_values, serialize_env

from robozium.api.app import create_app
from robozium.hub.utils import load_hub

URL = "/credentials/environment"
@pytest.fixture
def client(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    return TestClient(create_app(deployment=load_hub(start=tmp_path)))


def save(client, entries, password=None, revision=None):
    return client.post(
        URL,
        json={
            "revision": revision or client.get(URL).json()["revision"],
            "entries": entries,
            "password": password,
        },
    )


def key_file(values, password="password", secret_names=None):
    secret = set(values) if secret_names is None else secret_names
    return serialize_env(
        encrypt_env_values(values, secret_names=secret, password=password)
    ).encode()


def replace_file(client, content, password="password", revision=None):
    data = {"revision": revision or client.get(URL).json()["revision"]}
    if password is not None:
        data["password"] = password
    return client.post(
        URL + "/file",
        data=data,
        files={"file": (".env.encrypt", content, "application/octet-stream")},
    )


def test_encrypted_edit_stale_save_and_manual_override(client, tmp_path):
    (tmp_path / ".env").write_text("TOKEN=manual-private\n")
    initial = client.get(URL).json()["revision"]
    assert (
        save(
            client,
            [{"name": "TOKEN", "value": "synthetic", "secret": True}],
            "password",
        ).status_code
        == 200
    )
    stored = (tmp_path / ".env.encrypt").read_bytes()
    assert b"synthetic" not in stored
    assert decrypt_env_values(
        dotenv_values(tmp_path / ".env.encrypt"), password="password"
    ) == {"TOKEN": "synthetic"}
    view = client.get(URL)
    assert "synthetic" not in view.text and "manual-private" not in view.text
    assert view.json()["entries"][0]["overridden"] is True
    assert save(client, [], "password", initial).status_code == 409
    assert save(client, [], "wrong").status_code == 400
    assert (tmp_path / ".env.encrypt").read_bytes() == stored
    assert save(client, [], "password").status_code == 200
    assert (tmp_path / ".env").read_text() == "TOKEN=manual-private\n"


@pytest.mark.parametrize(
    "entries, error",
    [
        (
            [{"name": "SETTING", "value": "one"}, {"name": "SETTING", "value": "two"}],
            "Variable names must be unique",
        ),
        (
            [{"name": "ROBOZIUM_ENCRYPTED_ENV_PATH", "value": "elsewhere"}],
            "This setting is controlled by the application",
        ),
        (
            [{"name": "ROBOZIUM_HUB_ROOT", "value": "/hub"}],
            "This setting is controlled by the application",
        ),
    ],
)
def test_invalid_edits_preserve_saved_settings(client, tmp_path, entries, error):
    path = tmp_path / ".env.encrypt"
    path.write_text("SETTING=original\n")
    response = save(client, entries, password="synthetic-password")
    assert response.status_code == 400
    assert response.json()["detail"] == error
    assert path.read_text() == "SETTING=original\n"


def test_retained_secret_requires_explicit_replacement_to_become_public(
    client, tmp_path
):
    assert (
        save(
            client,
            [{"name": "TOKEN", "value": "synthetic-secret", "secret": True}],
            password="password",
        ).status_code
        == 200
    )
    assert (
        save(
            client, [{"name": "TOKEN", "secret": True}], password="password"
        ).status_code
        == 200
    )
    path = tmp_path / ".env.encrypt"
    assert decrypt_env_values(dotenv_values(path), password="password") == {
        "TOKEN": "synthetic-secret"
    }
    stored = path.read_bytes()
    response = save(client, [{"name": "TOKEN", "secret": False}], password="password")
    assert response.status_code == 400
    assert (
        response.json()["detail"] == "Enter a replacement value to make a secret public"
    )
    assert path.read_bytes() == stored
    assert (
        save(client, [{"name": "TOKEN", "value": ""}], password="password").status_code
        == 200
    )
    assert dotenv_values(path) == {"TOKEN": ""}


def test_queued_run_blocks_saving(client):
    client.post("/projects", json={"name": "busy"})
    client.post("/run/create", json={"project": "busy"})
    assert client.get(URL).json()["editable"] is False
    assert save(client, []).status_code == 409
    assert replace_file(client, key_file({"TOKEN": "synthetic"})).status_code == 409
    assert client.delete(URL).status_code == 409
    client.post("/projects/busy/cancel")
    assert save(client, []).status_code == 200


def test_reset_deletes_unreadable_settings_without_password(client, tmp_path):
    path = tmp_path / ".env.encrypt"
    path.write_bytes(b"\xffunreadable-settings")
    manual = tmp_path / ".env"
    manual.write_text("MANUAL=keep\n")
    assert client.get(URL).status_code == 400
    response = client.delete(URL)
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert not path.exists()
    view = client.get(URL).json()
    assert view["entries"] == []
    assert view["requires_password"] is False
    assert manual.read_text() == "MANUAL=keep\n"
    assert client.delete(URL).status_code == 200


@pytest.mark.parametrize("unlocked", [False, True])
def test_reset_forgets_cached_secrets_and_accepts_a_new_password(
    client, tmp_path, monkeypatch, unlocked
):
    name = "TEST_RESET_TOKEN"
    monkeypatch.delenv(name, raising=False)
    assert (
        save(
            client, [{"name": name, "value": "old-secret", "secret": True}], "forgotten"
        ).status_code
        == 200
    )
    ciphertext = dotenv_values(tmp_path / ".env.encrypt")[name + "_ENCRYPTED"]
    monkeypatch.setenv(name + "_ENCRYPTED", ciphertext)
    # The desktop also passes ciphertext into the process at startup.
    restarted = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    if unlocked:
        assert (
            restarted.post(
                "/credentials/unlock", json={"password": "forgotten"}
            ).status_code
            == 200
        )
        assert os.environ[name] == "old-secret"
    assert restarted.delete(URL).status_code == 200
    assert name not in os.environ
    assert name + "_ENCRYPTED" not in os.environ
    assert restarted.get("/credentials").json() == {
        "available": False,
        "locked": False,
        "removable": False,
        "setup_required": False,
    }
    assert (
        save(
            restarted,
            [{"name": name, "value": "new-secret", "secret": True}],
            "new-password",
        ).status_code
        == 200
    )
    assert (
        restarted.post(
            "/credentials/unlock", json={"password": "new-password"}
        ).status_code
        == 200
    )
    assert os.environ[name] == "new-secret"


def test_failed_reset_preserves_settings(client, tmp_path, monkeypatch):
    path = tmp_path / ".env.encrypt"
    path.write_text("SETTING=keep\n")
    unlink = type(path).unlink

    def unavailable(target, *args, **kwargs):
        if target == path:
            raise PermissionError("cannot delete")
        return unlink(target, *args, **kwargs)

    monkeypatch.setattr(type(path), "unlink", unavailable)
    response = client.delete(URL)
    assert response.status_code == 503
    assert path.read_text() == "SETTING=keep\n"


def test_reset_rejects_cross_origin_requests(client, tmp_path):
    path = tmp_path / ".env.encrypt"
    path.write_text("SETTING=keep\n")
    response = client.delete(URL, headers={"Origin": "https://elsewhere.example"})
    assert response.status_code == 403
    assert path.read_text() == "SETTING=keep\n"


def test_configuration_boundaries_reject_cross_origin_oversized_and_private_errors(
    client,
):
    assert (
        client.post(
            URL, json={}, headers={"Origin": "https://elsewhere.example"}
        ).status_code
        == 403
    )
    assert (
        client.post(
            URL,
            content="x" * (256 * 1024 + 1),
            headers={"Content-Type": "application/json"},
        ).status_code
        == 413
    )
    response = client.post(
        URL, json={"entries": "private-secret", "password": "private-password"}
    )
    assert response.status_code == 400 and "private" not in response.text


def test_example_comments_do_not_change_multiline_values(client, tmp_path):
    (tmp_path / ".env.example").write_text(
        'MESSAGE="first\n# TOKEN=inside the value\nlast"\n'
        "# OPTIONAL=default\nLITERAL='${UNCHANGED}'\n"
    )
    response = client.get(URL)
    assert response.status_code == 200
    assert {
        entry["name"]: entry["value"] for entry in response.json()["suggestions"]
    } == {
        "MESSAGE": "first\n# TOKEN=inside the value\nlast",
        "OPTIONAL": "default",
        "LITERAL": "${UNCHANGED}",
    }


def test_broken_example_does_not_prevent_editing_valid_settings(client, tmp_path):
    (tmp_path / ".env.example").write_text("BROKEN='unterminated\n")
    response = client.get(URL)
    assert response.status_code == 200
    assert response.json()["example_errors"] == [
        "Could not read the application environment example"
    ]
    assert save(client, [{"name": "SETTING", "value": "value"}]).status_code == 200


def test_ambiguous_stored_names_are_rejected_without_exposing_values(client, tmp_path):
    (tmp_path / ".env.encrypt").write_text(
        "TOKEN=private-value\nTOKEN_ENCRYPTED=private-ciphertext\n"
    )
    response = client.get(URL)
    assert response.status_code == 400
    assert "collide" in response.json()["detail"]
    assert "private" not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_save_detects_changes_made_during_encryption_before_replacing_file(
    client, tmp_path, monkeypatch
):
    original = "SETTING=original\n"
    path = tmp_path / ".env.encrypt"
    path.write_text(original)
    fsync = os.fsync

    def external_edit(fd):
        fsync(fd)
        path.write_text("SETTING=external-edit\n")

    monkeypatch.setattr("robozium.api.environment_service.os.fsync", external_edit)
    response = save(client, [{"name": "SETTING", "value": "api-edit"}])
    assert response.status_code == 409
    assert path.read_text() == "SETTING=external-edit\n"
    assert not list(tmp_path.glob(".environment-*"))


def test_failed_replacement_preserves_settings_and_removes_temporary_file(
    client, tmp_path, monkeypatch
):
    path = tmp_path / ".env.encrypt"
    path.write_text("SETTING=original\n")

    def unavailable(*args):
        raise OSError("disk unavailable")

    monkeypatch.setattr("robozium.api.environment_service.os.replace", unavailable)
    response = save(client, [{"name": "SETTING", "value": "replacement"}])
    assert response.status_code == 503
    assert path.read_text() == "SETTING=original\n"
    assert not list(tmp_path.glob(".environment-*"))


def test_streamed_requests_cannot_bypass_size_limit(client):
    response = client.post(
        URL,
        content=(b"x" * 65536 for _ in range(5)),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    "headers, status",
    [
        ({"Origin": "https://testserver"}, 403),
        ({"Origin": "http://["}, 403),
        ({"Content-Type": "text/plain"}, 415),
        ({"Content-Length": "-1"}, 400),
        ({"Content-Length": str(256 * 1024 + 16 * 1024 + 1)}, 413),
    ],
)
def test_invalid_upload_headers_are_rejected_before_reading(
    client, tmp_path, headers, status
):
    response = client.post(
        URL + "/file",
        content=b"unused",
        headers={"Content-Type": "multipart/form-data; boundary=test"} | headers,
    )
    assert response.status_code == status
    assert response.headers["cache-control"] == "no-store"
    assert not (tmp_path / ".env.encrypt").exists()


def test_key_file_replaces_settings_only_when_its_password_opens_it(client, tmp_path):
    path = tmp_path / ".env.encrypt"
    path.write_text("SETTING=original\n")
    initial = client.get(URL).json()["revision"]
    content = key_file({"TOKEN": "synthetic"})

    wrong = replace_file(client, content, password="wrong")
    assert wrong.status_code == 400
    assert path.read_text() == "SETTING=original\n"

    adopted = replace_file(client, content)
    assert adopted.json() == {"status": "replaced", "loaded": False}
    assert path.read_bytes() == content
    assert decrypt_env_values(dotenv_values(path), password="password") == {
        "TOKEN": "synthetic"
    }
    # Outside first-start setup, the adopted keys apply after a restart.
    assert "TOKEN" not in os.environ
    assert replace_file(client, content, revision=initial).status_code == 409
    assert path.read_bytes() == content


@pytest.mark.parametrize(
    "content, error",
    [
        (b"A=1\nA=2\n", "Invalid or duplicate dotenv assignment"),
        (b"ROBOZIUM_ENCRYPTED_ENV_PATH=elsewhere\n", "This setting is controlled by the application"),
        (
            key_file({"ROBOZIUM_HUB_ROOT": "/hub"}),
            "This setting is controlled by the application",
        ),
        (b"TOKEN=\xff\n", "Environment file must be UTF-8"),
        (b"A" * (256 * 1024 + 1), "Environment file is too large"),
    ],
)
def test_invalid_key_files_preserve_saved_settings(client, tmp_path, content, error):
    path = tmp_path / ".env.encrypt"
    path.write_text("SETTING=original\n")
    response = replace_file(client, content)
    assert response.status_code == 400
    assert response.json()["detail"] == error
    assert path.read_text() == "SETTING=original\n"
