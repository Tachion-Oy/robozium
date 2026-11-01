"""Read a repository's capability index and download selected packages from GitHub.

Only GitHub repository URLs are accepted, and requests go to the GitHub API and
its archive host alone. Tokens are sent as headers and never appear in URLs,
files, or error messages.
"""

import re
import shutil
import tarfile
from dataclasses import dataclass
from http.client import HTTPMessage
from keyword import iskeyword
from pathlib import Path, PurePosixPath
from tempfile import TemporaryFile
from typing import IO, Annotated, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    OpenerDirector,
    Request,
    build_opener,
)

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from robozium.api.errors import RepositoryUnavailableError
from robozium.hub import environment as env

INDEX_FILE = "robozium.json"
FORMAT_URL = "https://github.com/Tachion-Oy/robozium#repository-imports"
MAX_INDEX_BYTES = 64 * 1024
MAX_ARCHIVE_BYTES = 128 * 1024 * 1024
MAX_PACKAGE_FILES = 2000
MAX_INDEXED_PACKAGES = 50
_TIMEOUT_S = 30
_API = "https://api.github.com"
_ARCHIVE_HOST = "codeload.github.com"
_NAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
_REPO = re.compile(r"[A-Za-z0-9._-]{1,100}")
_REF = re.compile(r"[A-Za-z0-9._/-]{1,200}")
_COMMIT = re.compile(r"[0-9a-f]{40}")


@dataclass(frozen=True)
class Repository:
    owner: str
    name: str
    ref: str | None = None

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.name}"

    @property
    def token_variable(self) -> str:
        """The settings entry that keeps this repository's access token."""
        slug = re.sub(r"[^A-Z0-9]", "_", f"{self.owner}_{self.name}".upper())
        return f"GITHUB_TOKEN_{slug}"


def parse_repository(url: str) -> Repository:
    """Accept ``https://github.com/<owner>/<repo>`` with an optional ``/tree/<ref>``."""
    message = "Enter a GitHub repository URL such as https://github.com/owner/repo"
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        raise ValueError(message) from None
    if (
        parts.scheme != "https"
        or parts.hostname != "github.com"
        or parts.port is not None
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
    ):
        raise ValueError(message)
    segments = parts.path.strip("/").split("/")
    if len(segments) < 2:
        raise ValueError(message)
    owner, name = segments[0], segments[1].removesuffix(".git")
    ref = None
    if len(segments) > 2:
        if segments[2] != "tree" or len(segments) < 4:
            raise ValueError(message)
        ref = "/".join(segments[3:])
        if not _REF.fullmatch(ref) or ".." in ref:
            raise ValueError("The branch or tag name is not supported")
    if not _NAME.fullmatch(owner) or not _REPO.fullmatch(name) or name in {".", ".."}:
        raise ValueError(message)
    return Repository(owner, name, ref)


def parse_full_name(full_name: str, ref: str | None) -> Repository:
    """Rebuild a repository recorded as ``owner/name`` in an import's source."""
    return parse_repository(f"https://github.com/{full_name}" + (f"/tree/{ref}" if ref else ""))


def _package_path(value: str) -> str:
    path = PurePosixPath(value)
    if (
        not value
        or value != path.as_posix()
        or path.is_absolute()
        or any(part in ("", ".", "..") for part in path.parts)
        or any(char in value for char in ("\\", ":", "\x00"))
    ):
        raise ValueError("Package paths must be relative folders inside the repository")
    if not path.name.isidentifier() or iskeyword(path.name):
        raise ValueError(f"Package folder {path.name!r} must be a valid Python package name")
    return value


class IndexedPackage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    path: str = Field(max_length=300)
    description: str | None = Field(default=None, max_length=500)

    _validate_path = field_validator("path")(_package_path)

    @property
    def name(self) -> str:
        return PurePosixPath(self.path).name


class RepositoryIndex(BaseModel):
    """The ``robozium.json`` file at a repository's root."""

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={"title": "Robozium repository index"},
    )
    schema_version: Literal[1] = Field(alias="schema")
    packages: Annotated[
        list[IndexedPackage], Field(min_length=1, max_length=MAX_INDEXED_PACKAGES)
    ]

    @field_validator("packages")
    @classmethod
    def _unique_names(cls, packages: list[IndexedPackage]) -> list[IndexedPackage]:
        names = [package.name for package in packages]
        if len(set(names)) != len(names):
            raise ValueError("Package folder names must be unique")
        return packages

    def package(self, path: str) -> IndexedPackage | None:
        return next((item for item in self.packages if item.path == path), None)


class _GitHubRedirects(HTTPRedirectHandler):
    """Follow redirects only to the GitHub API and archive hosts."""

    def redirect_request(
        self, req: Request, fp: IO[bytes], code: int, msg: str,
        headers: HTTPMessage, newurl: str,
    ) -> Request | None:
        host = urlsplit(newurl).hostname
        if urlsplit(newurl).scheme != urlsplit(_API).scheme or host not in {
            urlsplit(_API).hostname,
            _ARCHIVE_HOST,
        }:
            raise RepositoryUnavailableError("GitHub redirected to an unexpected host")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _opener() -> OpenerDirector:
    return build_opener(_GitHubRedirects)


def _get(
    repository: Repository, path: str, token: str | None, accept: str
) -> IO[bytes]:
    request = Request(
        f"{_API}/repos/{quote(repository.owner)}/{quote(repository.name)}/{path}",
        headers={
            "Accept": accept,
            "User-Agent": "Robozium",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    if token:
        request.add_unredirected_header("Authorization", f"Bearer {token}")
    try:
        return _opener().open(request, timeout=_TIMEOUT_S)
    except HTTPError as exc:
        exc.close()
        if exc.code in (401, 403, 404):
            raise ValueError(
                f"GitHub did not allow access to {repository.full_name}. "
                "Check the URL, and add a read-only token for a private repository."
            ) from None
        raise RepositoryUnavailableError(
            f"GitHub answered {exc.code}. Try again later."
        ) from None
    except (URLError, TimeoutError) as exc:
        raise RepositoryUnavailableError("Could not reach GitHub. Check the connection.") from exc


def _read_limited(stream: IO[bytes], limit: int, what: str) -> bytes:
    with stream:
        content = stream.read(limit + 1)
    if len(content) > limit:
        raise ValueError(f"The {what} is too large")
    return content


def resolve_commit(repository: Repository, token: str | None) -> str:
    """Return the commit that the repository's branch, tag, or default branch names now."""
    ref = quote(repository.ref or "HEAD", safe="")
    content = _read_limited(
        _get(repository, f"commits/{ref}", token, "application/vnd.github.sha"),
        100,
        "commit response",
    )
    commit = content.decode("ascii", "replace").strip()
    if not _COMMIT.fullmatch(commit):
        raise RepositoryUnavailableError("GitHub returned an unexpected commit")
    return commit


def read_index(repository: Repository, commit: str, token: str | None) -> RepositoryIndex:
    """Read and validate ``robozium.json`` at one commit, without running any code."""
    if not _COMMIT.fullmatch(commit):
        raise ValueError("Unknown commit")
    try:
        stream = _get(
            repository,
            f"contents/{INDEX_FILE}?ref={commit}",
            token,
            "application/vnd.github.raw+json",
        )
    except ValueError:
        raise ValueError(
            f"{repository.full_name} has no readable {INDEX_FILE} at its root. "
            f"See {FORMAT_URL}"
        ) from None
    content = _read_limited(stream, MAX_INDEX_BYTES, INDEX_FILE)
    try:
        return RepositoryIndex.model_validate_json(content)
    except ValidationError as exc:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in error['loc']) or 'file'}: {error['msg']}"
            for error in exc.errors()[:5]
        )
        raise ValueError(f"Invalid {INDEX_FILE}: {problems}") from None


def download_packages(
    repository: Repository,
    commit: str,
    token: str | None,
    paths: list[str],
    destination: Path,
) -> None:
    """Extract each selected repository folder into ``destination/<folder name>``.

    Only regular files and directories inside the selected folders are written.
    Links, special files, unsafe names, and oversized packages reject the download.
    """
    if not _COMMIT.fullmatch(commit):
        raise ValueError("Unknown commit")
    selected = {PurePosixPath(_package_path(path)): PurePosixPath(path).name for path in paths}
    sizes = dict.fromkeys(selected, 0)
    counts = dict.fromkeys(selected, 0)
    found: set[PurePosixPath] = set()
    with TemporaryFile() as archive:
        with _get(repository, f"tarball/{commit}", token, "application/vnd.github+json") as stream:
            total = 0
            while chunk := stream.read(1024 * 1024):
                total += len(chunk)
                if total > MAX_ARCHIVE_BYTES:
                    raise ValueError("The repository archive is too large")
                archive.write(chunk)
        archive.seek(0)
        try:
            tar = tarfile.open(fileobj=archive, mode="r:gz")
        except tarfile.TarError:
            raise RepositoryUnavailableError("GitHub returned an unreadable archive") from None
        with tar:
            for member in tar:
                parts = PurePosixPath(member.name).parts[1:]  # Drop GitHub's top folder.
                if not parts:
                    continue
                relative = PurePosixPath(*parts)
                root = next(
                    (path for path in selected if relative == path or path in relative.parents),
                    None,
                )
                if root is None:
                    continue
                if member.name.startswith("/") or any(part in ("", ".", "..") for part in parts) or any(
                    char in member.name for char in ("\\", ":", "\x00")
                ):
                    raise ValueError(f"{root} contains an unsafe file name")
                if not (member.isfile() or member.isdir()):
                    raise ValueError(
                        f"{root} contains a link or special file ({relative}); "
                        "only regular files are imported"
                    )
                found.add(root)
                target = destination / selected[root] / relative.relative_to(root)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                counts[root] += 1
                sizes[root] += member.size
                if counts[root] > MAX_PACKAGE_FILES or sizes[root] > env.MAX_PACKAGE_BYTES:
                    raise ValueError(f"{root} is too large to import")
                source = tar.extractfile(member)
                if source is None:
                    raise ValueError(f"{root} contains an unreadable file ({relative})")
                target.parent.mkdir(parents=True, exist_ok=True)
                with source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
    missing = sorted(str(path) for path in selected if path not in found)
    if missing:
        raise ValueError(f"The repository has no folder {', '.join(missing)}")


def index_schema() -> dict[str, object]:
    """The JSON Schema published for ``robozium.json``."""
    return RepositoryIndex.model_json_schema(by_alias=True)
