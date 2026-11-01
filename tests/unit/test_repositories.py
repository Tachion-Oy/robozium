"""Repositories import every package their index lists, update all or none, and remove cleanly."""

import json
import os
import subprocess
import threading
from pathlib import Path

import pytest
from config_support import write_config
from fastapi.testclient import TestClient

from robozium.api import repositories
from robozium.api.app import create_app
from robozium.api.environment_service import EnvironmentService
from robozium.api.repositories import Repository
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
    assert (hub / ".env.encrypt").read_text() == ""
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
    fetch = Repository.fetch
    held = []

    def check_lock(repository, destination):
        lock = client.app.state.projects._lock
        def probe():
            acquired = lock.acquire(timeout=1)
            if acquired:
                lock.release()
            held.append(not acquired)

        thread = threading.Thread(target=probe)
        thread.start()
        thread.join()
        return fetch(repository, destination)

    monkeypatch.setattr(Repository, "fetch", check_lock)
    assert add(client).status_code == 200
    assert held == [False]


def test_a_folder_without_its_entry_can_be_removed_or_added_again(client, hub, source):
    assert add(client).status_code == 200
    (hub / ".env.encrypt").write_text("ROBOZIUM_REPOSITORY_OTHER_ENCRYPTED='x'\n")
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


BODY = "QUJD" * 35
# Canonical form: 70 characters per line.
KEY = f"-----BEGIN OPENSSH PRIVATE KEY-----\n{BODY[:70]}\n{BODY[70:]}\n-----END OPENSSH PRIVATE KEY-----\n"


@pytest.fixture
def private(tmp_path, source, monkeypatch):
    """The same local repository, reached as GitHub's SSH address for a deploy key."""
    monkeypatch.setattr(repositories, "GIT_CONFIG", [
        *repositories.GIT_CONFIG,
        f"url.file://{tmp_path / 'remote'}/.insteadOf=git@github.com:acme/",
    ])
    return source


def add_private(client, password="password", key=KEY):
    return client.post(URL + "/repositories", json={
        "url": REPOSITORY, "deploy_key": key.replace("\n", " "), "password": password,
    })


def test_deploy_key_is_saved_encrypted_and_used_for_updates(client, hub, private, monkeypatch):
    monkeypatch.delenv("ROBOZIUM_DEPLOY_KEY_TOOLKIT", raising=False)
    response = add_private(client)
    assert response.status_code == 200, response.text
    assert response.json()["repository"]["name"] == "toolkit"
    stored = (hub / ".env.encrypt").read_text()
    assert "ROBOZIUM_DEPLOY_KEY_TOOLKIT_ENCRYPTED=" in stored
    assert "QUJD" not in stored
    assert not any("QUJD" in path.read_text(errors="ignore")
                   for path in (hub / "local").rglob("*") if path.is_file())
    view = client.get(URL).json()
    assert view["entries"] == []
    assert view["repositories"][0]["private"] is True
    # Loaded at once in canonical lines, so Update needs no restart.
    assert os.environ["ROBOZIUM_DEPLOY_KEY_TOOLKIT"] == KEY
    assert client.post(URL + "/repositories/toolkit/update").status_code == 200
    monkeypatch.delenv("ROBOZIUM_DEPLOY_KEY_TOOLKIT")
    locked = client.post(URL + "/repositories/toolkit/update")
    assert locked.status_code == 400
    assert locked.json()["detail"] == "Unlock your settings to update toolkit"
    assert client.delete(URL + "/repositories/toolkit").status_code == 200
    assert (hub / ".env.encrypt").read_text() == ""


def test_wrong_password_or_key_fetches_nothing(client, hub, private, monkeypatch):
    monkeypatch.delenv("ROBOZIUM_DEPLOY_KEY_TOOLKIT", raising=False)
    revision = client.get(URL).json()["revision"]
    assert client.post(URL, json={
        "revision": revision, "entries": [{"name": "OTHER", "value": "v", "secret": True}],
        "password": "first",
    }).status_code == 200
    calls = []
    monkeypatch.setattr(repositories.subprocess, "run", lambda *args, **kwargs: calls.append(args))
    assert add_private(client, password="wrong").status_code == 400
    response = add_private(client, key="not a key")
    assert response.status_code == 400
    assert "whole private deploy key" in response.json()["detail"]
    assert calls == []
    assert not (hub / "local/repositories/toolkit").exists()


def test_deploy_key_uses_ssh_with_pinned_github_host_keys(client, monkeypatch):
    seen = {}

    def fail(command, env, **kwargs):
        seen.update(command=command, env=env, key=Path(env["GIT_SSH_COMMAND"].split()[-1]).read_text())
        return subprocess.CompletedProcess(command, 128, "", "git@github.com: Permission denied (publickey).")

    monkeypatch.setattr(repositories.subprocess, "run", fail)
    response = add_private(client)
    assert response.status_code == 400
    assert "this deploy key is added to the repository" in response.json()["detail"]
    assert "git@github.com:acme/toolkit" in seen["command"]
    assert "protocol.ssh.allow=always" in seen["command"]
    ssh = seen["env"]["GIT_SSH_COMMAND"]
    for option in ("-F /dev/null", "BatchMode=yes", "StrictHostKeyChecking=yes", "IdentitiesOnly=yes"):
        assert option in ssh
    assert seen["key"] == KEY
    assert not Path(ssh.split()[-1]).exists()
