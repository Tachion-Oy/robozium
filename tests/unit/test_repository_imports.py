"""Repository imports read an index, download only chosen folders, and update atomically."""

import io
import json
import tarfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
FIRST = "a" * 40
SECOND = "b" * 40
SCHEMA = Path(__file__).parents[2] / "docs" / "robozium.schema.json"


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


def tree(**folders):
    files = {"robozium.json": json.dumps({
        "schema": 1,
        "packages": [{"path": path, "description": f"{path} tools"} for path in folders],
    })}
    for path, content in folders.items():
        files.update({f"{path}/{name}": data for name, data in content.items()})
    return files


class FakeGitHub:
    """Serve commits, raw index files, and tarballs the way the GitHub API does."""

    def __init__(self):
        self.commits = {"HEAD": FIRST}
        self.trees = {FIRST: tree(**{"tools/weather": package("weather"), "skills/notes": package("notes")})}
        self.links: dict[str, dict[str, str]] = {}
        self.requests: list[tuple[str, str | None]] = []
        self.redirect: str | None = None
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                fake.requests.append((self.path, self.headers.get("Authorization")))
                prefix = "/repos/acme/kit/"
                if not self.path.startswith(prefix):
                    return self.send_error(404)
                path = self.path.removeprefix(prefix)
                if path.startswith("commits/"):
                    commit = fake.commits.get(path.removeprefix("commits/"))
                    return self.reply(commit.encode() if commit else None)
                if path.startswith("contents/robozium.json?ref="):
                    files = fake.trees.get(path.split("=", 1)[1], {})
                    content = files.get("robozium.json")
                    return self.reply(content.encode() if content else None)
                if path.startswith("tarball/"):
                    if fake.redirect:
                        self.send_response(302)
                        self.send_header("Location", fake.redirect)
                        self.end_headers()
                        return None
                    commit = path.removeprefix("tarball/")
                    return self.reply(fake.archive(commit) if commit in fake.trees else None)
                return self.send_error(404)

            def reply(self, body):
                if body is None:
                    return self.send_error(404)
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return None

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.server.server_address[1]}"

    def archive(self, commit):
        buffer = io.BytesIO()
        top = f"acme-kit-{commit[:7]}"
        with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
            for name, content in self.trees[commit].items():
                data = content.encode() if isinstance(content, str) else content
                info = tarfile.TarInfo(f"{top}/{name}")
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
            for name, target in self.links.get(commit, {}).items():
                info = tarfile.TarInfo(f"{top}/{name}")
                info.type = tarfile.SYMTYPE
                info.linkname = target
                tar.addfile(info)
        return buffer.getvalue()

    def downloads(self):
        return [path for path, _ in self.requests if "/tarball/" in path]


@pytest.fixture
def github(monkeypatch):
    fake = FakeGitHub()
    monkeypatch.setattr(github_source, "_API", fake.url)
    yield fake
    fake.server.shutdown()


@pytest.fixture
def client(tmp_path, monkeypatch):
    write_config(tmp_path)
    monkeypatch.setenv("ROBOZIUM_ENCRYPTED_ENV_PATH", str(tmp_path / ".env.encrypt"))
    return TestClient(create_app(deployment=load_hub(start=tmp_path)))


def preview(client, url=REPO, token=None):
    return client.post(URL + "/repository/preview", json={"url": url, "token": token})


def import_repo(client, paths, commit=FIRST, token=None, password=None):
    return client.post(URL + "/repository/import", json={
        "url": REPO, "commit": commit, "paths": paths,
        "token": token, "password": password,
    })


def update(client):
    return client.post(URL + "/repository/update", json={"repository": "acme/kit"})


def test_preview_lists_indexed_packages_without_downloading_code(client, github):
    response = preview(client)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "repository": "acme/kit", "ref": None, "commit": FIRST,
        "packages": [
            {"path": "tools/weather", "name": "weather", "description": "tools/weather tools", "installed": False},
            {"path": "skills/notes", "name": "notes", "description": "skills/notes tools", "installed": False},
        ],
    }
    assert github.downloads() == []


def test_import_publishes_only_chosen_folders_and_saves_the_token_encrypted(
    client, github, tmp_path
):
    response = import_repo(client, ["tools/weather"], token="ghp_secret", password="pw")
    assert response.status_code == 200, response.text
    [imported] = response.json()["imported"]
    assert imported["name"] == "weather"
    assert imported["source"] == {
        "repository": "acme/kit", "ref": None, "commit": FIRST,
        "path": "tools/weather", "token_variable": "GITHUB_TOKEN_ACME_KIT",
    }
    assert [cap["name"] for cap in imported["capabilities"]] == ["weather"]
    imports = tmp_path / "local/imports"
    assert sorted(path.name for path in imports.iterdir()) == ["weather"]
    for file in imports.rglob("*"):
        assert not file.is_file() or b"ghp_secret" not in file.read_bytes()
    stored = dotenv_values(tmp_path / ".env.encrypt", interpolate=False)
    assert "GITHUB_TOKEN_ACME_KIT" not in stored
    assert decrypt_env_values(stored, password="pw")["GITHUB_TOKEN_ACME_KIT"] == "ghp_secret"
    assert all(auth == "Bearer ghp_secret" for _, auth in github.requests)
    assert client.get(URL).json()["imports"] == [imported]
    assert preview(client).json()["packages"][0]["installed"] is True


def test_token_requires_the_settings_password_before_downloading(client, github, tmp_path):
    response = import_repo(client, ["tools/weather"], token="ghp_secret")
    assert response.status_code == 400
    assert "password" in response.json()["detail"]
    assert github.downloads() == []
    assert not (tmp_path / "local/imports/weather").exists()


def test_one_failing_package_publishes_nothing(client, github, tmp_path):
    github.trees[FIRST]["skills/notes/__init__.py"] = "raise RuntimeError('broken')\n"
    response = import_repo(client, ["tools/weather", "skills/notes"])
    assert response.status_code == 400
    assert "broken" in response.json()["detail"]
    assert not any((tmp_path / "local/imports").iterdir())


def test_links_inside_chosen_folders_are_refused_and_ignored_elsewhere(
    client, github, tmp_path
):
    github.links[FIRST] = {"docs/elsewhere": "/etc/passwd"}
    assert import_repo(client, ["skills/notes"]).status_code == 200
    github.links[FIRST] = {"tools/weather/data": "/etc/passwd"}
    response = import_repo(client, ["tools/weather"])
    assert response.status_code == 400
    assert "link or special file" in response.json()["detail"]
    assert not (tmp_path / "local/imports/weather").exists()


def test_oversized_package_is_refused(client, github, monkeypatch, tmp_path):
    monkeypatch.setattr(github_source, "MAX_PACKAGE_FILES", 1)
    response = import_repo(client, ["tools/weather"])
    assert response.status_code == 400
    assert "too large" in response.json()["detail"]
    assert not (tmp_path / "local/imports/weather").exists()


@pytest.mark.parametrize(
    ("index", "error"),
    [
        (None, "no readable robozium.json"),
        ('{"schema": 1, "packages": [{"path": "../evil"}]}', "relative folders"),
        ('{"schema": 1, "packages": [{"path": "a/x"}, {"path": "b/x"}]}', "unique"),
        ('{"schema": 1, "packages": [{"path": "x", "run": "now"}]}', "Extra inputs"),
        ('{"schema": 2, "packages": [{"path": "x"}]}', "schema"),
        ("not json", "Invalid robozium.json"),
    ],
)
def test_invalid_index_is_refused_with_a_reason(client, github, index, error):
    if index is None:
        del github.trees[FIRST]["robozium.json"]
    else:
        github.trees[FIRST]["robozium.json"] = index
    response = preview(client)
    assert response.status_code == 400
    assert error in response.json()["detail"]


def test_import_refuses_paths_missing_from_the_index(client, github):
    response = import_repo(client, ["tools/other"])
    assert response.status_code == 400
    assert "not listed" in response.json()["detail"]


def test_update_replaces_all_packages_and_reports_up_to_date(client, github, tmp_path):
    assert import_repo(client, ["tools/weather", "skills/notes"]).status_code == 200
    first = update(client)
    assert first.status_code == 200, first.text
    assert first.json()["updated"] is False
    github.commits["HEAD"] = SECOND
    github.trees[SECOND] = tree(**{
        "tools/weather": package("weather", "VERSION = 2\n"),
        "skills/notes": package("notes"),
    })
    response = update(client)
    assert response.status_code == 200, response.text
    assert response.json()["updated"] is True
    assert {item["source"]["commit"] for item in response.json()["imported"]} == {SECOND}
    assert {row["source"] for row in response.json()["suggestions"]} == {"weather", "notes"}
    weather = tmp_path / "local/imports/weather"
    assert "VERSION = 2" in (weather / "__init__.py").read_text()
    assert json.loads((weather / "source.json").read_text())["commit"] == SECOND
    assert sorted(path.name for path in (tmp_path / "local/imports").iterdir()) == [
        "notes", "weather"
    ]


def test_failed_update_keeps_the_installed_versions(client, github, tmp_path):
    assert import_repo(client, ["tools/weather", "skills/notes"]).status_code == 200
    before = (tmp_path / "local/imports/weather/__init__.py").read_text()
    github.commits["HEAD"] = SECOND
    github.trees[SECOND] = tree(**{
        "tools/weather": package("weather", "VERSION = 2\n"),
        "skills/notes": {"__init__.py": "raise RuntimeError('broken')\n", "env.example": ""},
    })
    response = update(client)
    assert response.status_code == 400
    assert (tmp_path / "local/imports/weather/__init__.py").read_text() == before
    assert json.loads(
        (tmp_path / "local/imports/notes/source.json").read_text()
    )["commit"] == FIRST
    assert {item["source"]["commit"] for item in client.get(URL).json()["imports"]} == {FIRST}


def test_update_stops_when_the_index_drops_an_imported_package(client, github, tmp_path):
    assert import_repo(client, ["tools/weather", "skills/notes"]).status_code == 200
    github.commits["HEAD"] = SECOND
    github.trees[SECOND] = tree(**{"tools/weather": package("weather")})
    response = update(client)
    assert response.status_code == 400
    assert "no longer lists skills/notes" in response.json()["detail"]
    assert (tmp_path / "local/imports/notes/source.json").is_file()


def test_update_of_an_unknown_repository_is_not_found(client, github):
    assert update(client).status_code == 404


def test_redirects_to_other_hosts_are_refused(client, github, tmp_path):
    github.redirect = "http://example.invalid/archive.tar.gz"
    response = import_repo(client, ["tools/weather"])
    assert response.status_code == 502
    assert "unexpected host" in response.json()["detail"]
    assert not (tmp_path / "local/imports/weather").exists()


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://github.com/acme/kit", ("acme", "kit", None)),
        ("https://github.com/acme/kit.git", ("acme", "kit", None)),
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
