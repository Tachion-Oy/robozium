"""A repository's index decides which folders are downloaded and copied."""

import json
import subprocess
from pathlib import Path

import pytest

from robozium.api import repositories
from robozium.api.errors import RepositoryUnavailableError
from robozium.api.repositories import Repository

URL = "https://github.com/acme/toolkit"


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
        "tools/alpha/__init__.py": "", "tools/alpha/env.example": "",
        "beta/__init__.py": "", "beta/data/file.txt": "data",
        "README.md": "not a package\n",
    })
    monkeypatch.setattr(repositories, "GIT_CONFIG", [
        *repositories.GIT_CONFIG, "protocol.file.allow=always",
        f"url.file://{tmp_path / 'remote'}/.insteadOf=https://github.com/acme/",
    ])
    return source


def test_listed_folders_are_copied_by_their_last_name(source, tmp_path):
    destination = tmp_path / "out"
    destination.mkdir()
    assert Repository(URL).fetch(destination) == ["alpha", "beta"]
    assert (destination / "beta/data/file.txt").read_text() == "data"
    assert not (destination / "README.md").exists()


def test_only_listed_folders_are_downloaded(source, tmp_path, monkeypatch):
    commit(source, {
        "robozium.json": json.dumps({"packages": ["beta"]}),
        "beta/__init__.py": "", "assets/large.bin": "x" * 1_000_000,
    })
    checkouts = []
    copy = repositories.shutil.copytree

    def record_checkout(source_path, target):
        checkouts.append(source_path.parent)
        return copy(source_path, target)

    monkeypatch.setattr(repositories.shutil, "copytree", record_checkout)
    (tmp_path / "out").mkdir()
    Repository(URL).fetch(tmp_path / "out")
    assert not (checkouts[0] / "assets").exists()


@pytest.mark.parametrize(("files", "error"), [
    ({"README.md": ""}, "no robozium.json"),
    ({"robozium.json": "{"}, "not valid JSON"),
    ({"robozium.json": '{"packages": []}'}, "list of package folder paths"),
    ({"robozium.json": '{"packages": ["../x"]}'}, "relative folder"),
    ({"robozium.json": '{"packages": ["."]}'}, "relative folder"),
    ({"robozium.json": '{"packages": [""]}'}, "relative folder"),
    ({"robozium.json": '{"packages": ["a/x", "b/x"]}'}, "must be unique"),
    ({"robozium.json": '{"packages": ["missing"]}'}, "no folder missing"),
    ({"robozium.json": '{"packages": ["class"]}'}, "valid Python package name"),
])
def test_invalid_index_copies_nothing(source, tmp_path, files, error):
    commit(source, files)
    (tmp_path / "out").mkdir()
    with pytest.raises(ValueError, match=error):
        Repository(URL).fetch(tmp_path / "out")
    assert not list((tmp_path / "out").iterdir())


def test_links_and_oversized_folders_are_refused(source, tmp_path, monkeypatch):
    (source / "beta" / "link").symlink_to("/etc/passwd")
    record(source)
    (tmp_path / "out").mkdir()
    with pytest.raises(ValueError, match="link"):
        Repository(URL).fetch(tmp_path / "out")
    (source / "beta" / "link").unlink()
    record(source)
    monkeypatch.setattr(repositories, "MAX_REPOSITORY_BYTES", 3)
    (tmp_path / "retry").mkdir()
    with pytest.raises(ValueError, match="too large"):
        Repository(URL).fetch(tmp_path / "retry")


@pytest.mark.parametrize("url", [
    "http://github.com/acme/toolkit",
    "https://gitlab.com/acme/toolkit",
    "https://github.com/acme",
    "https://github.com/acme/toolkit/tree/main",
    "https://user@github.com/acme/toolkit",
    "file:///etc",
])
def test_only_github_repository_urls_are_accepted(url):
    with pytest.raises(ValueError, match="GitHub repository URL"):
        Repository(url)


def test_name_is_the_last_part_of_the_url():
    assert Repository("https://github.com/acme/Robo-Tools.git").name == "robo_tools"


def test_unknown_repository_and_missing_git(source, tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="did not allow access"):
        Repository("https://github.com/acme/absent").fetch(tmp_path)
    monkeypatch.setattr(repositories.shutil, "which", lambda name: None)
    with pytest.raises(RepositoryUnavailableError, match="git is missing from the backend image"):
        Repository(URL).fetch(tmp_path)
