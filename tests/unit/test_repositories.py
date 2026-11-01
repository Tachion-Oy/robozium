"""Repositories import every package their index lists, update all or none, and remove cleanly."""

import json
import os
import subprocess
import threading
from pathlib import Path

import pytest
from config_support import write_config
from fastapi.testclient import TestClient
from roboz.endpoints import encrypt_env_values, serialize_env

from robozium.api import repositories
from robozium.api.app import create_app
from robozium.api.credentials import missing_environment_files
from robozium.api.environment_service import EnvironmentService
from robozium.hub import local
from robozium.hub.utils import load_hub

URL = "/credentials/environment"
REPOSITORY = "https://github.com/acme/toolkit"


def tool(label):
    return (
        "from roboz.deployment import Capability, ToolLabel\n"
        "from roboz.tools import stop\n"
        f"TOOL = Capability(label=ToolLabel({label!r}, selectable=True), value=stop)\n"
    )


def commit(source: Path, files: dict[str, str]) -> None:
    """Replace the repository's tracked files and commit them."""
    for path in source.glob("*"):
        if path.name != ".git":
            subprocess.run(["rm", "-rf", str(path)], check=True)
    for path, content in files.items():
        (source / path).parent.mkdir(parents=True, exist_ok=True)
        (source / path).write_text(content)
    record(source)


def record(source: Path) -> None:
    git = ["git", "-C", str(source), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "add", "-A"], check=True)
    subprocess.run([*git, "commit", "-qm", "change", "--allow-empty"], check=True)


def package(label):
    return {"__init__.py": tool(label), "env.example": "ALPHA_TOKEN=\n"}


@pytest.fixture
def source(tmp_path, monkeypatch):
    """A local git repository that https://github.com/acme/toolkit resolves to."""
    source = tmp_path / "remote" / "toolkit"
    source.mkdir(parents=True)
    subprocess.run(["git", "init", "-q", str(source)], check=True)
    # As on GitHub, so the blob-filtered clone downloads only what it checks out.
    subprocess.run(["git", "-C", str(source), "config", "uploadpack.allowFilter", "true"], check=True)
    commit(source, {
        "robozium.json": json.dumps({"packages": ["tools/alpha", "beta"]}),
        **{f"tools/alpha/{name}": text for name, text in package("alpha_tool").items()},
        **{f"beta/{name}": text for name, text in package("beta_tool").items()},
        "README.md": "not a package\n",
    })
    monkeypatch.setattr(repositories, "GIT_CONFIG", [
        *repositories.GIT_CONFIG, "protocol.file.allow=always",
        f"url.file://{tmp_path / 'remote'}/.insteadOf=https://github.com/acme/",
    ])
    return source


@pytest.fixture
def hub(tmp_path, monkeypatch):
    hub = tmp_path / "hub"
    hub.mkdir()
    write_config(hub)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(hub / ".env.encrypt"))
    return hub


@pytest.fixture
def client(hub):
    return TestClient(create_app(deployment=load_hub(start=hub)))


def restart(hub):
    """A new API process for the same hub; the loader caches per process."""
    local._load_local_packages.cache_clear()
    return TestClient(create_app(deployment=load_hub(start=hub)))


def add(client, url=REPOSITORY):
    return client.post(URL + "/repositories", json={"url": url})


def names(packages):
    return [(item["name"], [cap["name"] for cap in item["capabilities"]]) for item in packages]


def test_add_imports_every_listed_package_and_saves_only_the_url(client, hub, source):
    response = add(client)
    assert response.status_code == 200, response.text
    repository = response.json()["repository"]
    assert repository["name"] == "toolkit"
    assert names(repository["packages"]) == [("alpha", ["alpha_tool"]), ("beta", ["beta_tool"])]
    assert sorted(path.name for path in (hub / "local/repositories/toolkit").iterdir()) == [
        "alpha", "beta",
    ]
    assert (hub / ".env.encrypt").read_text() == f"ROBOZIUM_REPOSITORY_TOOLKIT='{REPOSITORY}'\n"
    view = client.get(URL).json()
    assert view["entries"] == []
    assert view["repositories"][0]["url"] == REPOSITORY
    assert {row["source"] for row in view["suggestions"]} == {"alpha", "beta"}
    conflict = add(client)
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == f"A repository named toolkit is already added from {REPOSITORY}"


def test_restart_loads_repository_packages(client, hub, source):
    assert add(client).status_code == 200
    restarted = restart(hub)
    view = restarted.get(URL).json()
    assert names(view["repositories"][0]["packages"]) == [
        ("alpha", ["alpha_tool"]), ("beta", ["beta_tool"]),
    ]
    assert all(item["active"] for item in view["repositories"][0]["packages"])
    assert {"alpha_tool", "beta_tool"} <= {
        row["name"] for row in restarted.get("/capabilities").json()
    }


def test_update_follows_the_index_and_keeps_old_versions_on_failure(client, hub, source):
    assert add(client).status_code == 200
    restarted = restart(hub)
    commit(source, {
        "robozium.json": json.dumps({"packages": ["tools/alpha", "gamma"]}),
        **{f"tools/alpha/{name}": text for name, text in package("alpha_tool").items()},
        **{f"gamma/{name}": text for name, text in package("gamma_tool").items()},
    })
    response = restarted.post(URL + "/repositories/toolkit/update")
    assert response.status_code == 200, response.text
    assert names(response.json()["repository"]["packages"]) == [
        ("alpha", ["alpha_tool"]), ("gamma", ["gamma_tool"]),
    ]
    assert not (hub / "local/repositories/toolkit/beta").exists()

    commit(source, {
        "robozium.json": json.dumps({"packages": ["broken"]}),
        "broken/__init__.py": "raise RuntimeError('broken package')\n",
        "broken/env.example": "",
    })
    response = restarted.post(URL + "/repositories/toolkit/update")
    assert response.status_code == 400
    assert "broken package" in response.json()["detail"]
    assert sorted(path.name for path in (hub / "local/repositories/toolkit").iterdir()) == [
        "alpha", "gamma",
    ]


def test_remove_deletes_packages_and_entry(client, hub, source):
    assert add(client).status_code == 200
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert not (hub / "local/repositories/toolkit").exists()
    assert client.get(URL).json()["repositories"] == []
    # The file held only the repository, so removing it leaves no settings at all.
    assert not (hub / ".env.encrypt").exists()
    assert client.delete(URL + "/repositories/toolkit").status_code == 404
    assert client.post(URL + "/repositories/toolkit/update").status_code == 404
    assert add(client).status_code == 200


def test_saving_variables_keeps_repository_entries(client, hub, source):
    assert add(client).status_code == 200
    revision = client.get(URL).json()["revision"]
    saved = client.post(URL, json={
        "revision": revision, "entries": [{"name": "ALPHA_TOKEN", "value": "x"}],
    })
    assert saved.status_code == 200, saved.text
    assert client.get(URL).json()["repositories"][0]["url"] == REPOSITORY
    revision = client.get(URL).json()["revision"]
    refused = client.post(URL, json={
        "revision": revision,
        "entries": [{"name": "ROBOZIUM_REPOSITORY_OTHER", "value": REPOSITORY}],
    })
    assert refused.status_code == 400


def test_invalid_index_imports_nothing(client, hub, source):
    commit(source, {"robozium.json": '{"packages": ["missing"]}'})
    response = add(client)
    assert response.status_code == 400
    assert "no folder missing" in response.json()["detail"]
    assert not (hub / "local/repositories/toolkit").exists()
    assert not (hub / ".env.encrypt").exists()
    assert not list((hub / "local").glob(".staging-*"))


def test_invalid_url_is_refused(client):
    assert add(client, "https://gitlab.com/acme/toolkit").status_code == 400


def test_unknown_repository_and_missing_git(client, source, monkeypatch):
    response = add(client, "https://github.com/acme/absent")
    assert response.status_code == 400
    assert "did not allow access" in response.json()["detail"]
    monkeypatch.setattr(repositories.shutil, "which", lambda name: None)
    response = add(client)
    assert response.status_code == 502
    assert response.json()["detail"] == "git is missing from the backend image"


def test_download_does_not_pause_runs(client, source, monkeypatch):
    fetch = repositories.fetch
    held = []

    def check_lock(url, destination):
        lock = client.app.state.projects._lock
        def probe():
            acquired = lock.acquire(timeout=1)
            if acquired:
                lock.release()
            held.append(not acquired)

        thread = threading.Thread(target=probe)
        thread.start()
        thread.join()
        return fetch(url, destination)

    monkeypatch.setattr(repositories, "fetch", check_lock)
    assert add(client).status_code == 200
    assert held == [False]


def test_a_folder_without_its_entry_can_be_removed_or_added_again(client, hub, source):
    assert add(client).status_code == 200
    (hub / ".env.encrypt").write_text("SETTING='x'\n")
    [orphan] = client.get(URL).json()["repositories"]
    assert (orphan["name"], orphan["url"]) == ("toolkit", "")
    assert client.post(URL + "/repositories/toolkit/update").status_code == 404
    assert add(client).status_code == 200
    (hub / ".env.encrypt").write_text("")
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert not (hub / "local/repositories/toolkit").exists()
    assert client.get(URL).json()["repositories"] == []


def test_a_failed_add_keeps_label_state(client, hub, source, monkeypatch):
    assert add(client).status_code == 200
    restarted = restart(hub)
    # The loaded labels are freed for reuse once their repository is removed.
    assert restarted.delete(URL + "/repositories/toolkit").status_code == 200
    write = EnvironmentService._write_entries

    def refuse(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(EnvironmentService, "_write_entries", refuse)
    assert add(restarted).status_code == 503
    assert not (hub / "local/repositories/toolkit").exists()
    monkeypatch.setattr(EnvironmentService, "_write_entries", write)
    response = add(restarted)
    assert response.status_code == 200, response.text


def encrypted_entry(hub, name="ROBOZIUM_REPOSITORY_TOOLKIT", extra=""):
    """A settings file whose repository entry is stored encrypted, as an adopted file can hold."""
    values = encrypt_env_values({name: REPOSITORY}, secret_names={name}, password="password")
    (hub / ".env.encrypt").write_text(serialize_env(values) + extra)


def test_an_encrypted_entry_is_listed_refuses_a_duplicate_and_can_be_removed(client, hub, source):
    encrypted_entry(hub)
    view = client.get(URL)
    assert view.status_code == 200
    assert [(item["name"], item["url"]) for item in view.json()["repositories"]] == [("toolkit", "")]
    assert view.json()["requires_password"] is True
    assert add(client).status_code == 409
    assert client.get(URL).status_code == 200
    update = client.post(URL + "/repositories/toolkit/update")
    assert update.status_code == 404
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert client.get(URL).json()["repositories"] == []


def test_a_hidden_secret_makes_saving_ask_for_the_password(client, hub):
    encrypted_entry(hub, extra="SETTING='x'\n")
    view = client.get(URL).json()
    assert [entry["name"] for entry in view["entries"]] == ["SETTING"]
    assert view["requires_password"] is True
    revision = view["revision"]
    edit = {"revision": revision, "entries": [{"name": "SETTING", "value": "y"}]}
    assert client.post(URL, json=edit).status_code == 400
    assert client.post(URL, json=edit | {"password": "password"}).status_code == 200
    assert "ROBOZIUM_REPOSITORY_TOOLKIT_ENCRYPTED=" in (hub / ".env.encrypt").read_text()


def test_repositories_alone_never_end_first_start_setup(client, hub, source):
    path = hub / ".env.encrypt"
    assert missing_environment_files(path)
    assert add(client).status_code == 200
    assert missing_environment_files(path)
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert not path.exists()
    path.write_text("")
    assert not missing_environment_files(path)
    path.write_text("ROBOZIUM_REPOSITORY_TOOLKIT='x'\nKEY='y'\n")
    assert not missing_environment_files(path)


def test_remove_works_without_a_local_folder(client, hub):
    (hub / ".env.encrypt").write_text(f"ROBOZIUM_REPOSITORY_TOOLKIT='{REPOSITORY}'\nSETTING='x'\n")
    assert not (hub / "local").exists()
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert (hub / ".env.encrypt").read_text() == "SETTING='x'\n"


def test_update_remove_and_add_again_before_restart(client, hub, source):
    assert add(client).status_code == 200
    restarted = restart(hub)
    assert restarted.post(URL + "/repositories/toolkit/update").status_code == 200
    assert restarted.delete(URL + "/repositories/toolkit").status_code == 200
    # The loaded labels are free again, although an update replaced them in between.
    response = add(restarted)
    assert response.status_code == 200, response.text


def test_update_stops_if_the_url_changed_during_the_download(client, hub, source, monkeypatch):
    assert add(client).status_code == 200
    fetch = repositories.fetch

    def replace_url(url, destination):
        text = (hub / ".env.encrypt").read_text().replace("acme/toolkit", "other/toolkit")
        (hub / ".env.encrypt").write_text(text)
        return fetch(url, destination)

    monkeypatch.setattr(repositories, "fetch", replace_url)
    response = client.post(URL + "/repositories/toolkit/update")
    assert response.status_code == 409
    assert "changed while downloading" in response.json()["detail"]


def test_remove_deletes_a_link_in_place_of_the_folder(client, hub, tmp_path):
    target = tmp_path / "elsewhere"
    target.mkdir()
    (hub / "local/repositories").mkdir(parents=True)
    os.symlink(target, hub / "local/repositories/toolkit")
    assert [item["name"] for item in client.get(URL).json()["repositories"]] == ["toolkit"]
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert not (hub / "local/repositories/toolkit").is_symlink()
    assert target.is_dir()
    assert client.get(URL).json()["repositories"] == []


def test_removing_a_leftover_folder_after_reset_keeps_first_start_setup(client, hub, source):
    assert add(client).status_code == 200
    (hub / ".env.encrypt").unlink()
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert not (hub / ".env.encrypt").exists()
    assert missing_environment_files(hub / ".env.encrypt")
