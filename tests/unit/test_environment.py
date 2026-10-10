"""Environment configuration uses disposable files and real encryption."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from config_support import write_config
from fastapi.testclient import TestClient
from roboz.endpoints import decrypt_env_values
from roboz.runtime.persistence import mark_conversation_active

from robozium.api.app import create_app, mock_app
from robozium.hub.utils import load_hub
from robozium.settings.environment import (
    EnvironmentConflict,
    EnvironmentEdit,
    EnvironmentRow,
    EnvironmentStore,
    load_root_environment,
    parse_values,
)


def edit(store, *entries, password=None):
    return EnvironmentEdit(revision=store.snapshot()["revision"], entries=[EnvironmentRow(**row) for row in entries], password=password)


def test_root_roundtrip_replacement_removal_and_no_plaintext_file(tmp_path):
    store = EnvironmentStore(tmp_path)
    store.save(edit(store, {"name": "ODD_NAME", "value": "first-synthetic", "secret": True}, {"name": "TIMESHEET_ROOT", "value": "readonly/test"}, password="password"))
    assert not (tmp_path / ".env").exists()
    text = (tmp_path / ".env.encrypt").read_text()
    assert "first-synthetic" not in text
    assert "ODD_NAME_ENCRYPTED" in text
    assert "first-synthetic" not in str(store.snapshot())
    before = parse_values(text)
    store.save(edit(store, {"name": "ODD_NAME", "secret": True}, password="password"))
    assert parse_values((tmp_path / ".env.encrypt").read_text())["ODD_NAME_ENCRYPTED"] == before["ODD_NAME_ENCRYPTED"]
    assert "TIMESHEET_ROOT" not in (tmp_path / ".env.encrypt").read_text()
    store.save(edit(store, {"name": "ODD_NAME", "value": "replacement", "secret": True}, password="password"))
    assert decrypt_env_values(parse_values((tmp_path / ".env.encrypt").read_text()), password="password") == {"ODD_NAME": "replacement"}
    store.save(edit(store, password="password"))
    assert (tmp_path / ".env.encrypt").read_text() == ""


def test_manual_env_is_preserved_and_identified_without_revealing_values(tmp_path):
    source = tmp_path / ".env"
    source.write_text("ODD_NAME=manual-secret\n")
    store = EnvironmentStore(tmp_path)
    store.save(edit(store, {"name": "ODD_NAME", "value": "synthetic", "secret": True}, password="password"))
    view = store.snapshot()
    assert view["entries"][0]["overridden"] is True
    assert "manual-secret" not in str(view)
    assert source.read_text() == "ODD_NAME=manual-secret\n"


def test_container_root_values_remain_literal_and_preserve_controlled_paths(tmp_path, monkeypatch):
    monkeypatch.setenv("ROBOZIUM_ENV_ROOT", str(tmp_path))
    monkeypatch.setenv("ROBOZIUM_ENV_CONTROL", str(tmp_path / "control"))
    monkeypatch.setenv("ROBOZIUM_HUB_ROOT", "/hub")
    monkeypatch.setenv("ROBOZIUM_LOCAL_DIRS", "/app/catalogue")
    monkeypatch.setenv("ODD_PATH", "value-altered-by-compose")
    monkeypatch.setenv("ODD_DOLLAR", "value-altered-by-compose")
    monkeypatch.setenv("ODD_OVERRIDE", "value-from-encrypted-file")
    store = EnvironmentStore(tmp_path)
    store.save(edit(store, {"name": "ODD_PATH", "value": r"C:\temp\reports"},
                    {"name": "ODD_DOLLAR", "value": r"literal${TOKEN}\path"},
                    {"name": "ODD_OVERRIDE", "value": "original"},
                    {"name": "ROBOZIUM_HUB_ROOT", "value": "host-path"},
                    {"name": "ROBOZIUM_LOCAL_DIRS", "value": "host-catalogue"}))
    (tmp_path / ".env").write_text("ODD_OVERRIDE=manual\n")
    load_root_environment()
    import os
    assert os.environ["ODD_PATH"] == r"C:\temp\reports"
    assert os.environ["ODD_DOLLAR"] == r"literal${TOKEN}\path"
    assert os.environ["ODD_OVERRIDE"] == "manual"
    assert os.environ["ROBOZIUM_HUB_ROOT"] == "/hub"
    assert os.environ["ROBOZIUM_LOCAL_DIRS"] == "/app/catalogue"


def test_bad_password_stale_revision_and_invalid_names_do_not_change_file(tmp_path):
    store = EnvironmentStore(tmp_path)
    stale = edit(store)
    store.save(edit(store, {"name": "ODD_NAME", "value": "synthetic", "secret": True}, password="password"))
    before = (tmp_path / ".env.encrypt").read_bytes()
    with pytest.raises(EnvironmentConflict):
        store.save(stale)
    with pytest.raises(ValueError):
        store.save(edit(store, password="wrong"))
    for row in ({"name": "BAD_ENCRYPTED", "value": "x"}, {"name": "ROBOZIUM_HUB_ROOT", "value": "x", "secret": True}, {"name": "ROBOZIUM_MODE", "value": "live"}):
        with pytest.raises(ValueError):
            store.save(edit(store, row, password="password"))
    assert (tmp_path / ".env.encrypt").read_bytes() == before


def test_two_tabs_cannot_overwrite_each_other(tmp_path):
    store = EnvironmentStore(tmp_path)
    first = edit(store, {"name": "A", "value": "first"})
    second = edit(store, {"name": "A", "value": "second"})
    def save(change):
        try:
            store.save(change)
            return "saved"
        except EnvironmentConflict:
            return "conflict"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(save, [first, second])) == ["conflict", "saved"]


def test_examples_preserve_conflicting_defaults_and_ignore_capability_dotenv(tmp_path, monkeypatch):
    catalogue = tmp_path / "catalogue"
    skill = catalogue / "skills" / "example"
    skill.mkdir(parents=True)
    (tmp_path / ".env.example").write_text("# ROBOZIUM_WEB_PORT=6969\nODD=one\n")
    (skill / ".env.example").write_text("ODD=two\nSERVICE_API_KEY=\n")
    (skill / ".env").write_text("PRIVATE=never-read\n")
    monkeypatch.setenv("ROBOZIUM_LOCAL_DIRS", str(catalogue))
    suggestions, errors = EnvironmentStore(tmp_path).suggestions()
    assert not errors
    assert [row["value"] for row in suggestions if row["name"] == "ODD"] == ["one", "two"]
    assert next(row for row in suggestions if row["name"] == "SERVICE_API_KEY")["secret"] is True
    assert "PRIVATE" not in str(suggestions)


def test_host_transaction_contains_ciphertext_only(tmp_path):
    control = tmp_path / "control"
    store = EnvironmentStore(tmp_path, control=control)
    store.save(edit(store, {"name": "ODD", "value": "synthetic-secret", "secret": True}, password="password"))
    assert not (tmp_path / ".env").exists() and not (tmp_path / ".env.encrypt").exists()
    assert (control / "request").read_text() == "apply"
    assert all("synthetic-secret" not in file.read_text() and "password" not in file.read_text() for file in control.iterdir())


def test_environment_editing_blocks_queued_runs_and_new_runs_during_apply(tmp_path, monkeypatch):
    write_config(tmp_path)
    control = tmp_path / "control"
    monkeypatch.setenv("ROBOZIUM_ENV_CONTROL", str(control))
    app = create_app(deployment=load_hub(start=tmp_path))
    client = TestClient(app)
    client.post("/projects", json={"name": "example"})
    queued = client.post("/run/create", json={"project": "example"})
    assert queued.status_code == 200
    view = client.get("/admin/environment").json()
    assert view["editable"] is False
    body = {"revision": view["revision"], "entries": [{"name": "ODD", "value": "x"}]}
    assert client.post("/admin/environment", json=body).status_code == 409
    assert not (control / "request").exists()
    client.post("/projects/example/cancel")
    assert client.get("/admin/environment").json()["editable"] is True
    assert client.post("/admin/environment", json=body).status_code == 202
    assert client.post("/run/create", json={"project": "example"}).status_code == 409
    (control / "status").write_text("failed_configuration")
    assert client.get("/admin/environment").json()["editable"] is True
    assert client.post("/run/create", json={"project": "example"}).status_code == 200


def test_environment_errors_do_not_echo_secrets(tmp_path):
    write_config(tmp_path)
    client = TestClient(create_app(deployment=load_hub(start=tmp_path)))
    response = client.post("/admin/environment", json={"revision": "x", "entries": "private-test-value", "password": "private-password"})
    assert response.status_code == 400
    assert "private" not in response.text
    assert client.post("/admin/environment", content="x", headers={"Content-Type": "text/plain"}).status_code == 415
    assert client.post("/admin/environment", json={}, headers={"Origin": "https://elsewhere.example"}).status_code == 403


def test_background_work_prevents_configuration_until_stopped(tmp_path):
    write_config(tmp_path)
    hub = load_hub(start=tmp_path)
    client = TestClient(create_app(deployment=hub))
    assert client.post("/projects", json={"name": "background"}).status_code == 200
    marker = mark_conversation_active(agent_dir=hub.project("background").logs / "librarian", conversation_id="synthetic")
    view = client.get("/admin/environment").json()
    assert view["editable"] is False
    body = {"revision": view["revision"], "entries": [{"name": "ODD", "value": "example"}]}
    assert client.post("/admin/environment", json=body).status_code == 409
    assert not (tmp_path / ".env.encrypt").exists()
    marker.unlink()
    assert client.get("/admin/environment").json()["editable"] is True
    assert client.post("/admin/environment", json=body).status_code == 202


def test_mock_configuration_is_available_after_catalogue_failure(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ROBOZIUM_BOOT_ERROR", "Synthetic catalogue failure")
    client = TestClient(mock_app())
    assert client.get("/ready").status_code == 200
    assert client.get("/admin/environment").json()["boot_error"] == "Synthetic catalogue failure"
