"""Repository imports read an index, copy only chosen folders, and update atomically."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest
from config_support import write_config
from dotenv import dotenv_values
from fastapi.testclient import TestClient
from roboz.endpoints import decrypt_env_values

from robozium.api import github_source
from robozium.api.app import create_app
from robozium.hub.utils import load_hub

URL = "/credentials/environment"
REPO = "https://github.com/acme/kit"
SCHEMA = Path(__file__).parents[2] / "docs" / "robozium.schema.json"
# Not a usable key; it only has the shape of one.
KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQUJDRA==\n-----END OPENSSH PRIVATE KEY-----\n"


def package(label, extra=""):
    return {
        "__init__.py": (
            "from roboz.deployment import Capability, ToolLabel\n"
            "from roboz.tools import stop\n"
            f"TOOL = Capability(label=ToolLabel({label!r}, selectable=True), value=stop)\n"
            + extra
        ),
        "env.example": f"{label.upper()}_TOKEN=\n",
    }


def tree(index=None, **folders):
    files = {"robozium.json": index if index is not None else json.dumps({
        "schema": 1,
        "packages": [{"path": path, "description": f"{path} tools"} for path in folders],
    })}
    for path, content in folders.items():
        files.update({f"{path}/{name}": data for name, data in content.items()})
    return files


class Remote:
    """A local stand-in for a GitHub repository, read through git like the real one."""

    def __init__(self, root: Path):
        root.mkdir(parents=True)
        self.work = root / "work"
        self.bare = root / "kit.git"
        self.git("init", "-q", "-b", "main", str(self.work), cwd=root)
        self.git("init", "-q", "--bare", "-b", "main", str(self.bare), cwd=root)
        self.first = ""
        self.keys: list[str | None] = []

    def git(self, *args, cwd=None):
        environment = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                       "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}
        return subprocess.run(
            ["git", *args], cwd=cwd or self.work, env=environment,
            check=True, capture_output=True, text=True,
        ).stdout.strip()

    def commit(self, files, links=None, branch="main"):
        self.git("checkout", "-q", "-B", branch)
        for child in self.work.iterdir():
            if child.name != ".git":
                shutil.rmtree(child) if child.is_dir() and not child.is_symlink() else child.unlink()
        for name, content in files.items():
            path = self.work / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        for name, target in (links or {}).items():
            path = self.work / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.symlink_to(target)
        self.git("add", "-A")
        self.git("commit", "-q", "--allow-empty", "-m", "change")
        self.git("push", "-q", "--force", str(self.bare), f"{branch}:{branch}")
        return self.git("rev-parse", "HEAD")


@pytest.fixture
def remote(tmp_path, monkeypatch):
    repository = Remote(tmp_path / "remote")
    repository.first = repository.commit(tree(**{
        "tools/weather": package("weather"), "skills/notes": package("notes"),
    }))

    def fake_remote(target, key):
        repository.keys.append(key)
        return f"file://{repository.bare}"

    monkeypatch.setattr(github_source, "remote", fake_remote)
    monkeypatch.setattr(github_source, "_PROTOCOLS", ("file",))
    return repository


@pytest.fixture
def client(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    return TestClient(create_app(deployment=load_hub(start=tmp_path)))


def preview(client, url=REPO, deploy_key=None):
    return client.post(URL + "/repository/preview", json={"url": url, "deploy_key": deploy_key})


def import_repo(client, paths, commit, deploy_key=None, password=None, url=REPO):
    return client.post(URL + "/repository/import", json={
        "url": url, "commit": commit, "paths": paths,
        "deploy_key": deploy_key, "password": password,
    })


def update(client):
    return client.post(URL + "/repository/update", json={"repository": "acme/kit"})


def test_preview_lists_indexed_packages_at_the_current_commit(client, remote):
    response = preview(client)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "repository": "acme/kit", "ref": None, "commit": remote.first,
        "packages": [
            {"path": "tools/weather", "name": "weather", "description": "tools/weather tools", "installed": False},
            {"path": "skills/notes", "name": "notes", "description": "skills/notes tools", "installed": False},
        ],
    }


def test_import_publishes_only_chosen_folders_and_saves_the_deploy_key_encrypted(
    client, remote, tmp_path
):
    pasted = KEY.replace("\n", " ")
    response = import_repo(client, ["tools/weather"], remote.first, deploy_key=pasted, password="pw")
    assert response.status_code == 200, response.text
    [imported] = response.json()["imported"]
    assert imported["name"] == "weather"
    assert imported["source"] == {
        "repository": "acme/kit", "ref": None, "commit": remote.first,
        "path": "tools/weather", "key_variable": "GITHUB_DEPLOY_KEY_ACME_KIT",
    }
    assert [cap["name"] for cap in imported["capabilities"]] == ["weather"]
    imports = tmp_path / "local/imports"
    assert sorted(path.name for path in imports.iterdir()) == ["weather"]
    for file in imports.rglob("*"):
        assert not file.is_file() or b"PRIVATE KEY" not in file.read_bytes()
    stored = dotenv_values(tmp_path / ".env.encrypt", interpolate=False)
    assert "GITHUB_DEPLOY_KEY_ACME_KIT" not in stored
    # A key pasted into a single-line field is saved with its line breaks restored.
    saved = decrypt_env_values(stored, password="pw")["GITHUB_DEPLOY_KEY_ACME_KIT"]
    assert saved == (
        "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAAQUJDRA==\n"
        "-----END OPENSSH PRIVATE KEY-----\n"
    )
    assert set(remote.keys) == {pasted}
    assert client.get(URL).json()["imports"] == [imported]
    assert preview(client).json()["packages"][0]["installed"] is True


def test_saved_deploy_key_is_used_when_none_is_typed(client, remote, monkeypatch):
    monkeypatch.setenv("GITHUB_DEPLOY_KEY_ACME_KIT", KEY)
    assert preview(client).status_code == 200
    assert set(remote.keys) == {KEY}


@pytest.mark.parametrize(
    ("key", "password", "error"),
    [("not a key", "pw", "whole private deploy key"), (KEY, None, "password")],
)
def test_bad_key_or_missing_password_fails_before_fetching(
    client, remote, tmp_path, key, password, error
):
    response = import_repo(client, ["tools/weather"], remote.first, deploy_key=key, password=password)
    assert response.status_code == 400
    assert error in response.json()["detail"]
    assert remote.keys == []
    assert not (tmp_path / "local/imports/weather").exists()


def test_git_runs_ssh_with_only_the_deploy_key_and_githubs_host_keys(tmp_path):
    repository = github_source.parse_repository(REPO)
    git = github_source._Git(repository, KEY, tmp_path)
    command = git.environment["GIT_SSH_COMMAND"]
    for option in ("IdentitiesOnly=yes", "StrictHostKeyChecking=yes", "BatchMode=yes", "-F /dev/null"):
        assert option in command
    assert (tmp_path / "deploy_key").stat().st_mode & 0o777 == 0o600
    assert (tmp_path / "known_hosts").read_text().startswith("github.com ssh-ed25519 ")
    assert github_source.remote(repository, KEY) == "git@github.com:acme/kit.git"
    assert github_source.remote(repository, None) == "https://github.com/acme/kit.git"


def test_only_https_and_ssh_are_allowed(client, remote, monkeypatch):
    monkeypatch.setattr(github_source, "_PROTOCOLS", ("https", "ssh"))
    assert preview(client).status_code == 502


def test_one_failing_package_publishes_nothing(client, remote, tmp_path):
    commit = remote.commit(tree(**{
        "tools/weather": package("weather"),
        "skills/notes": {"__init__.py": "raise RuntimeError('broken')\n", "env.example": ""},
    }))
    response = import_repo(client, ["tools/weather", "skills/notes"], commit)
    assert response.status_code == 400
    assert "broken" in response.json()["detail"]
    assert not any((tmp_path / "local/imports").iterdir())


def test_links_inside_chosen_folders_are_refused_and_ignored_elsewhere(client, remote, tmp_path):
    files = tree(**{"tools/weather": package("weather"), "skills/notes": package("notes")})
    commit = remote.commit(files, links={
        "docs/elsewhere": "/etc/passwd", "tools/weather/data": "/etc/passwd",
    })
    assert import_repo(client, ["skills/notes"], commit).status_code == 200
    response = import_repo(client, ["tools/weather"], commit)
    assert response.status_code == 400
    assert "link or special file" in response.json()["detail"]
    assert not (tmp_path / "local/imports/weather").exists()


def test_oversized_package_is_refused(client, remote, monkeypatch, tmp_path):
    monkeypatch.setattr(github_source, "MAX_PACKAGE_FILES", 1)
    response = import_repo(client, ["tools/weather"], remote.first)
    assert response.status_code == 400
    assert "too large" in response.json()["detail"]
    assert not (tmp_path / "local/imports/weather").exists()


@pytest.mark.parametrize(
    ("index", "error"),
    [
        (None, "no robozium.json"),
        ('{"schema": 1, "packages": [{"path": "../evil"}]}', "relative folders"),
        ('{"schema": 1, "packages": [{"path": "a/x"}, {"path": "b/x"}]}', "unique"),
        ('{"schema": 1, "packages": [{"path": "x", "run": "now"}]}', "Extra inputs"),
        ('{"schema": 2, "packages": [{"path": "x"}]}', "schema"),
        ("not json", "Invalid robozium.json"),
    ],
)
def test_invalid_index_is_refused_with_a_reason(client, remote, index, error):
    files = tree(index=index or "", **{"tools/weather": package("weather")})
    if index is None:
        del files["robozium.json"]
    remote.commit(files)
    response = preview(client)
    assert response.status_code == 400
    assert error in response.json()["detail"]


def test_branches_and_tags_resolve_and_unknown_ones_are_named(client, remote):
    commit = remote.commit(tree(**{"tools/weather": package("weather")}), branch="release/2")
    assert preview(client, REPO + "/tree/release/2").json()["commit"] == commit
    remote.git("tag", "-a", "v1", "-m", "v1", commit)
    remote.git("push", "-q", str(remote.bare), "v1")
    assert preview(client, REPO + "/tree/v1").json()["commit"] == commit
    response = preview(client, REPO + "/tree/missing")
    assert response.status_code == 400
    assert "no branch or tag named missing" in response.json()["detail"]


def test_one_repository_is_imported_from_one_branch(client, remote):
    assert import_repo(client, ["tools/weather"], remote.first).status_code == 200
    response = import_repo(client, ["skills/notes"], remote.first, url=REPO + "/tree/main")
    assert response.status_code == 409
    assert "already imported from its default branch" in response.json()["detail"]


def test_import_refuses_paths_missing_from_the_index(client, remote):
    response = import_repo(client, ["tools/other"], remote.first)
    assert response.status_code == 400
    assert "not listed" in response.json()["detail"]


def test_update_replaces_all_packages_and_reports_up_to_date(client, remote, tmp_path):
    assert import_repo(client, ["tools/weather", "skills/notes"], remote.first).status_code == 200
    first = update(client)
    assert first.status_code == 200, first.text
    assert first.json()["updated"] is False
    second = remote.commit(tree(**{
        "tools/weather": package("weather", "VERSION = 2\n"),
        "skills/notes": package("notes"),
    }))
    response = update(client)
    assert response.status_code == 200, response.text
    assert response.json()["updated"] is True
    assert {item["source"]["commit"] for item in response.json()["imported"]} == {second}
    assert {row["source"] for row in response.json()["suggestions"]} == {"weather", "notes"}
    weather = tmp_path / "local/imports/weather"
    assert "VERSION = 2" in (weather / "__init__.py").read_text()
    assert json.loads((weather / "source.json").read_text())["commit"] == second
    assert sorted(path.name for path in (tmp_path / "local/imports").iterdir()) == [
        "notes", "weather"
    ]


def test_failed_update_keeps_the_installed_versions(client, remote, tmp_path):
    assert import_repo(client, ["tools/weather", "skills/notes"], remote.first).status_code == 200
    before = (tmp_path / "local/imports/weather/__init__.py").read_text()
    remote.commit(tree(**{
        "tools/weather": package("weather", "VERSION = 2\n"),
        "skills/notes": {"__init__.py": "raise RuntimeError('broken')\n", "env.example": ""},
    }))
    response = update(client)
    assert response.status_code == 400
    assert (tmp_path / "local/imports/weather/__init__.py").read_text() == before
    assert json.loads(
        (tmp_path / "local/imports/notes/source.json").read_text()
    )["commit"] == remote.first
    imports = client.get(URL).json()["imports"]
    assert {item["source"]["commit"] for item in imports} == {remote.first}


def test_update_stops_when_the_index_drops_an_imported_package(client, remote, tmp_path):
    assert import_repo(client, ["tools/weather", "skills/notes"], remote.first).status_code == 200
    remote.commit(tree(**{"tools/weather": package("weather")}))
    response = update(client)
    assert response.status_code == 400
    assert "no longer lists skills/notes" in response.json()["detail"]
    assert (tmp_path / "local/imports/notes/source.json").is_file()


def test_update_of_an_unknown_repository_is_not_found(client, remote):
    assert update(client).status_code == 404


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/acme/kit", ("acme", "kit", None)),
        ("https://github.com/acme/kit.git", ("acme", "kit", None)),
        ("git@github.com:acme/kit.git", ("acme", "kit", None)),
        ("https://github.com/acme/kit/tree/release/2", ("acme", "kit", "release/2")),
    ],
)
def test_repository_urls_are_parsed(url, expected):
    repository = github_source.parse_repository(url)
    assert (repository.owner, repository.name, repository.ref) == expected


@pytest.mark.parametrize(
    "url",
    [
        "http://github.com/acme/kit",
        "https://gitlab.com/acme/kit",
        "git@gitlab.com:acme/kit.git",
        "https://user:pw@github.com/acme/kit",
        "https://github.com/acme",
        "https://github.com/acme/kit/blob/main/x",
        "https://github.com/acme/kit/tree/../x",
        "https://github.com/acme/kit?x=1",
    ],
)
def test_other_urls_are_refused(url):
    with pytest.raises(ValueError):
        github_source.parse_repository(url)


def test_published_schema_matches_the_index_model():
    assert json.loads(SCHEMA.read_text()) == github_source.index_schema()
