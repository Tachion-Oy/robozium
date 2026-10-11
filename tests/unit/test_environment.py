"""Folder import confirms real exports, preserves package files, and survives restart."""

import json
import os
import subprocess
import sys

import pytest
from config_support import write_config
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from roboz.endpoints import decrypt_env_values

from robozium.api.app import create_app
from robozium.hub.utils import load_hub

URL = "/credentials/environment"
SOURCE = """from roboz.deployment import Capability, ToolLabel, SkillLabel
from roboz.tools import stop
from .nested import NAME
TOOLS = Capability(label=ToolLabel(NAME, selectable=True), value=stop)
ALIAS = TOOLS
class Guide(Capability):
    def __init__(self):
        super().__init__(label=SkillLabel('actual_guide', selectable=True))
    def build(self, agent, pipe):
        raise AssertionError('discovery must not build capabilities')
"""


@pytest.fixture
def client(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    return TestClient(create_app(deployment=load_hub(start=tmp_path)))


def upload(client, files=None, name="bundle"):
    content = (
        {
            "__init__.py": SOURCE,
            "env.example": "SERVICE_TOKEN=\n# HOST=localhost\n",
            "nested/__init__.py": "NAME = 'actual_tool'\n",
            "nested/resource.bin": b"\x00\xff\x01",
            ".env": "PRIVATE=not-a-suggestion\n",
        }
        if files is None
        else files
    )
    return client.post(
        URL + "/import",
        files=[
            ("files", (f"{name}/{path}", data, "application/octet-stream"))
            for path, data in content.items()
        ],
    )


def save(client, entries, password=None, revision=None):
    return client.post(
        URL,
        json={
            "revision": revision or client.get(URL).json()["revision"],
            "entries": entries,
            "password": password,
        },
    )


def test_import_confirms_actual_names_and_copies_entire_subtree_before_restart(
    client, tmp_path
):
    response = upload(client)
    assert response.status_code == 200, response.text
    imported = response.json()["imported"]
    assert [(item["name"], item["kind"]) for item in imported["capabilities"]] == [
        ("actual_tool", "tool"),
        ("actual_guide", "skill"),
    ]
    assert imported["active"] is False
    assert imported["variables"] == ["SERVICE_TOKEN", "HOST"]
    assert (
        tmp_path / "local/imports/bundle/nested/resource.bin"
    ).read_bytes() == b"\x00\xff\x01"
    assert (
        tmp_path / "local/imports/bundle/.env"
    ).read_text() == "PRIVATE=not-a-suggestion\n"
    view = client.get(URL).json()
    assert view["imports"] == [imported]
    assert {row["name"] for row in view["suggestions"]} == {"SERVICE_TOKEN", "HOST"}
    assert "actual_tool" not in {
        row["name"] for row in client.get("/capabilities").json()
    }
    assert not (tmp_path / ".env.encrypt").exists()


@pytest.mark.parametrize("mode", ["mock", "live"])
def test_restart_loads_copied_capabilities_and_recovers_confirmation(
    client, tmp_path, mode
):
    assert upload(client).status_code == 200
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import json; from fastapi.testclient import TestClient; "
            f"from robozium.api.app import {mode}_app; "
            f"client=TestClient({mode}_app()); "
            "print(json.dumps([client.get('/capabilities').json(), client.get('/credentials/environment').json()['imports']]))",
        ],
        cwd=tmp_path,
        env=os.environ | {"ROBOZIUM_CONFIG": str(tmp_path / "hub.config.py")},
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    capabilities, imported = json.loads(result.stdout)
    assert {"actual_tool", "actual_guide"} <= {row["name"] for row in capabilities}
    assert imported[0]["active"] is True
    assert imported[0]["variables"] == ["SERVICE_TOKEN", "HOST"]


@pytest.mark.parametrize(
    "files, error",
    [
        ({"env.example": ""}, "__init__.py"),
        ({"__init__.py": SOURCE, "nested/env.example": ""}, "at its root"),
        (
            {"__init__.py": "CAPABILITY = None", "env.example": ""},
            "Capability instance",
        ),
        (
            {
                "__init__.py": "from roboz.deployment import Capability, ToolLabel\nCAPABILITY = Capability(label=ToolLabel('unbound'))",
                "env.example": "",
            },
            "must implement build",
        ),
        ({"__init__.py": "broken python!", "env.example": ""}, "__init__.py"),
        (
            {"__init__.py": "import nonexistent_dependency", "env.example": ""},
            "nonexistent_dependency",
        ),
        ({"__init__.py": SOURCE, "env.example": "KEY=1\nKEY=2"}, "duplicate dotenv"),
        ({"../outside": "escape"}, "relative path"),
        ({"nested": "file", "nested/child.py": ""}, "both a file and a directory"),
        ({"nested//child.py": ""}, "relative path"),
        ({"__init__.py": SOURCE, "env.example": b"\xffprivate-value"}, "must be UTF-8"),
    ],
)
def test_invalid_import_never_commits_or_claims_success(client, tmp_path, files, error):
    response = upload(client, files)
    assert response.status_code == 400, response.text
    assert error in response.json()["detail"]
    assert not (tmp_path / "local/imports/bundle").exists()
    assert client.get(URL).json()["imports"] == []
    assert not list((tmp_path / "local/imports").glob(".upload-*"))


def test_existing_folder_and_duplicate_labels_preserve_committed_package(
    client, tmp_path
):
    assert upload(client).status_code == 200
    original = (tmp_path / "local/imports/bundle/__init__.py").read_bytes()
    assert upload(client).status_code == 409
    response = upload(client, name="another")
    assert response.status_code == 400 and "actual_tool" in response.text
    assert not (tmp_path / "local/imports/another").exists()
    assert (tmp_path / "local/imports/bundle/__init__.py").read_bytes() == original


def test_dunder_all_supports_a_constructed_subclass_without_constructing_it_again(
    client,
):
    source = """from roboz.deployment import Capability, ToolLabel
from roboz.tools import stop
class Configured(Capability):
    def __init__(self, name):
        super().__init__(label=ToolLabel(name, selectable=True), value=stop)
CAPABILITY = Configured('configured')
__all__ = ['Configured', 'CAPABILITY']
"""
    response = upload(
        client, {"__init__.py": source, ".env.example": "VALUE='${LITERAL}'\n"}
    )
    assert response.status_code == 200, response.text
    assert [cap["name"] for cap in response.json()["imported"]["capabilities"]] == [
        "configured"
    ]
    assert response.json()["suggestions"][0]["value"] == "${LITERAL}"


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
            [{"name": "ROBOZIUM_WEB_PORT", "value": "3000", "secret": True}],
            "Startup settings must remain unencrypted",
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


@pytest.mark.parametrize("port", ["", "0", "65536", "１２３", "abc"])
def test_invalid_web_port_is_rejected_before_saving(client, tmp_path, port):
    response = save(client, [{"name": "ROBOZIUM_WEB_PORT", "value": port}])
    assert response.status_code == 400
    assert (
        response.json()["detail"] == "Web port must be an integer between 1 and 65535"
    )
    assert not (tmp_path / ".env.encrypt").exists()


@pytest.mark.parametrize("port", ["1", "65535"])
def test_web_port_limits_can_be_saved_and_retained(client, tmp_path, port):
    assert (
        save(client, [{"name": "ROBOZIUM_WEB_PORT", "value": port}]).status_code == 200
    )
    assert save(client, [{"name": "ROBOZIUM_WEB_PORT"}]).status_code == 200
    assert dotenv_values(tmp_path / ".env.encrypt") == {"ROBOZIUM_WEB_PORT": port}
    assert client.get(URL).json()["entries"][0]["startup"] is True


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


def test_queued_run_blocks_saving_and_import(client):
    client.post("/projects", json={"name": "busy"})
    client.post("/run/create", json={"project": "busy"})
    assert client.get(URL).json()["editable"] is False
    assert save(client, []).status_code == 409
    assert upload(client).status_code == 409
    assert client.delete(URL).status_code == 409
    client.post("/projects/busy/cancel")
    assert upload(client).status_code == 200


def test_reset_deletes_unreadable_settings_without_password_and_preserves_imports(
    client, tmp_path
):
    assert upload(client).status_code == 200
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
    assert view["imports"][0]["name"] == "bundle"
    assert (tmp_path / "local/imports/bundle/__init__.py").is_file()
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
    # Compose also passes ciphertext into the process at startup.
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


def test_broken_import_example_preserves_confirmation_and_other_sources(
    client, tmp_path
):
    imported = upload(client).json()["imported"]
    (tmp_path / ".env.example").write_text("ROBOZIUM_WEB_PORT=3000\n")
    (tmp_path / "local/imports/bundle/env.example").write_text("BROKEN='unterminated\n")
    response = client.get(URL)
    assert response.status_code == 200
    view = response.json()
    assert view["imports"] == [imported]
    assert view["example_errors"] == ["Could not read environment example for bundle"]
    assert [row["name"] for row in view["suggestions"]] == ["ROBOZIUM_WEB_PORT"]


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


def test_dependency_timeout_leaves_import_retryable(client, tmp_path, monkeypatch):
    def unavailable(*args, **kwargs):
        raise subprocess.TimeoutExpired("uv", 180)

    with monkeypatch.context() as patch:
        patch.setattr("robozium.hub.local.subprocess.run", unavailable)
        response = upload(
            client,
            {
                "__init__.py": "",
                "env.example": "",
                "requirements.txt": "synthetic-package==1\n",
            },
        )
    assert response.status_code == 503
    assert "timed out" in response.text
    assert not list((tmp_path / "local/imports").iterdir())
    assert upload(client).status_code == 200


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
        ({"Content-Length": str(32 * 1024 * 1024 + 1)}, 413),
    ],
)
def test_invalid_upload_headers_are_rejected_before_copying(
    client, tmp_path, headers, status
):
    response = client.post(
        URL + "/import",
        content=b"unused",
        headers={"Content-Type": "multipart/form-data; boundary=test"} | headers,
    )
    assert response.status_code == status
    assert response.headers["cache-control"] == "no-store"
    assert not (tmp_path / "local").exists()
