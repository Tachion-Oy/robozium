"""Read a repository's capability index and copy selected packages from GitHub with git.

Only GitHub repositories are accepted. A private repository is read over SSH with
a read-only deploy key that its admins add and revoke per customer; GitHub's host
is checked against its published keys. Public repositories need no key. The key
exists on disk only in a private temporary folder for the duration of one command.
"""

import os
import re
import shlex
import shutil
import subprocess
import tarfile
import textwrap
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass
from keyword import iskeyword
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory, TemporaryFile
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from robozium.api.errors import RepositoryUnavailableError
from robozium.hub import environment as env

INDEX_FILE = "robozium.json"
FORMAT_URL = "https://github.com/Tachion-Oy/robozium#repository-imports"
MAX_INDEX_BYTES = 64 * 1024
MAX_FETCH_BYTES = 256 * 1024 * 1024
MAX_PACKAGE_FILES = 2000
MAX_INDEXED_PACKAGES = 50
MAX_KEY_CHARS = 16 * 1024
_TIMEOUT_S = 300
# Protocols git may use; tests add "file" for local repositories.
_PROTOCOLS = ("https", "ssh")
# https://api.github.com/meta "ssh_keys"; GitHub announces any change in advance.
_KNOWN_HOSTS = """\
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
"""
_NAME = re.compile(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})")
_REPO = re.compile(r"[A-Za-z0-9._-]{1,100}")
_REF = re.compile(r"[A-Za-z0-9._/-]{1,200}")
_COMMIT = re.compile(r"[0-9a-f]{40}")
_PRIVATE_KEY = re.compile(
    r"-----BEGIN (OPENSSH|RSA|EC) PRIVATE KEY-----(.*?)-----END \1 PRIVATE KEY-----", re.S
)


@dataclass(frozen=True)
class Repository:
    owner: str
    name: str
    ref: str | None = None

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.name}"

    @property
    def key_variable(self) -> str:
        """The settings entry that keeps this repository's deploy key."""
        slug = re.sub(r"[^A-Z0-9]", "_", f"{self.owner}_{self.name}".upper())
        return f"GITHUB_DEPLOY_KEY_{slug}"


def parse_repository(url: str) -> Repository:
    """Accept ``https://github.com/<owner>/<repo>[/tree/<ref>]`` or ``git@github.com:<owner>/<repo>.git``."""
    message = "Enter a GitHub repository URL such as https://github.com/owner/repo"
    value = url.strip()
    if value.startswith("git@github.com:"):
        value = "https://github.com/" + value.removeprefix("git@github.com:")
    try:
        parts = urlsplit(value)
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


def normalize_key(key: str) -> str:
    """Return an OpenSSH private key in canonical lines, or raise without echoing it.

    Single-line fields drop the key's line breaks when it is pasted, so the body
    is rewrapped rather than taken as typed.
    """
    match = _PRIVATE_KEY.fullmatch(key.strip()) if len(key) <= MAX_KEY_CHARS else None
    body = re.sub(r"\s", "", match[2]) if match else ""
    if not match or not body or not re.fullmatch(r"[A-Za-z0-9+/=]+", body):
        raise ValueError("Paste the whole private deploy key, including its BEGIN and END lines")
    label = f"{match[1]} PRIVATE KEY"
    return "\n".join([f"-----BEGIN {label}-----", *textwrap.wrap(body, 70), f"-----END {label}-----", ""])


def remote(repository: Repository, key: str | None) -> str:
    """The git URL: SSH with a deploy key, otherwise anonymous HTTPS."""
    if key:
        return f"git@github.com:{repository.full_name}.git"
    return f"https://github.com/{repository.full_name}.git"


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


class _Git:
    """Run git for one repository with an isolated home, configuration, and SSH identity."""

    def __init__(self, repository: Repository, key: str | None, folder: Path) -> None:
        self.repository = repository
        self.remote = remote(repository, key)
        self.directory = folder / "repository"
        known_hosts = folder / "known_hosts"
        known_hosts.write_text(_KNOWN_HOSTS)
        ssh = ["ssh", "-F", "/dev/null", "-o", "BatchMode=yes",
               "-o", "StrictHostKeyChecking=yes",
               "-o", f"UserKnownHostsFile={known_hosts}"]
        if key:
            identity = folder / "deploy_key"
            identity.touch(mode=0o600)
            identity.write_text(normalize_key(key))
            ssh += ["-o", "IdentitiesOnly=yes", "-i", str(identity)]
        self.environment = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(folder),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ASKPASS": "true",
            "GIT_SSH_COMMAND": shlex.join(ssh),
            "GIT_PROTOCOL_FROM_USER": "0",
        }
        self.config = ["-c", "protocol.allow=never"]
        for protocol in _PROTOCOLS:
            self.config += ["-c", f"protocol.{protocol}.allow=always"]

    def run(self, *args: str, output: int | None = subprocess.PIPE) -> bytes:
        try:
            result = subprocess.run(
                ["git", *self.config, *args],
                cwd=self.directory if self.directory.exists() else None,
                env=self.environment, stdout=output, stderr=subprocess.PIPE,
                timeout=_TIMEOUT_S, check=False,
            )
        except subprocess.TimeoutExpired:
            raise RepositoryUnavailableError("GitHub took too long to answer. Try again.") from None
        if result.returncode:
            raise self._failure(result.stderr.decode("utf-8", "replace"))
        return result.stdout or b""

    def _failure(self, detail: str) -> Exception:
        name = self.repository.full_name
        if "passphrase" in detail:
            return ValueError("Use a deploy key without a passphrase")
        if any(text in detail for text in (
            "Permission denied", "Repository not found", "Authentication failed",
            "could not read Username", "terminal prompts disabled", "not found",
        )):
            return ValueError(
                f"GitHub did not allow access to {name}. Check the URL, and for a "
                "private repository that this deploy key is added to it."
            )
        if "Host key verification failed" in detail:
            return RepositoryUnavailableError("GitHub's host key did not match. Do not retry on this network.")
        if "did not match any file" in detail:
            missing = re.findall(r"pathspec '([^']+)'", detail)
            return ValueError(f"The repository has no folder {', '.join(missing) or 'listed in the index'}")
        return RepositoryUnavailableError(f"Could not read {name} from GitHub. Check the connection.")


@contextmanager
def _git(repository: Repository, key: str | None) -> Generator[_Git]:
    with TemporaryDirectory(prefix="robozium-git-") as folder:
        yield _Git(repository, key, Path(folder))


def resolve_commit(repository: Repository, key: str | None) -> str:
    """Return the commit that the repository's branch, tag, or default branch names now."""
    with _git(repository, key) as git:
        ref = repository.ref or "HEAD"
        # The ^{} pattern asks for an annotated tag's commit as well as the tag.
        patterns = [ref] if ref == "HEAD" else [ref, f"{ref}^{{}}"]
        lines = git.run("ls-remote", "--", git.remote, *patterns).decode("ascii", "replace").splitlines()
    refs = {}
    for line in lines:
        commit, _, name = line.partition("\t")
        refs[name] = commit
    for name in ("HEAD",) if ref == "HEAD" else (
        f"refs/tags/{ref}^{{}}", f"refs/tags/{ref}", f"refs/heads/{ref}",
    ):
        commit = refs.get(name)
        if commit and _COMMIT.fullmatch(commit):
            return commit
    raise ValueError(f"{repository.full_name} has no branch or tag named {ref}")


class Snapshot:
    """One fetched commit; reads the index and extracts folders without running any code."""

    def __init__(self, git: _Git, commit: str) -> None:
        self._git = git
        self.commit = commit

    def index(self) -> RepositoryIndex:
        name = self._git.repository.full_name
        try:
            size = int(self._git.run("cat-file", "-s", f"{self.commit}:{INDEX_FILE}"))
        except (ValueError, RepositoryUnavailableError):
            raise ValueError(
                f"{name} has no {INDEX_FILE} at its root. See {FORMAT_URL}"
            ) from None
        if size > MAX_INDEX_BYTES:
            raise ValueError(f"The {INDEX_FILE} file is too large")
        content = self._git.run("cat-file", "blob", f"{self.commit}:{INDEX_FILE}")
        try:
            return RepositoryIndex.model_validate_json(content)
        except ValidationError as exc:
            problems = "; ".join(
                f"{'.'.join(str(part) for part in error['loc']) or 'file'}: {error['msg']}"
                for error in exc.errors()[:5]
            )
            raise ValueError(f"Invalid {INDEX_FILE}: {problems}") from None

    def extract(self, paths: list[str], destination: Path) -> None:
        """Copy each selected folder into ``destination/<folder name>``.

        Only regular files and directories are written. Links, submodules, unsafe
        names, and oversized packages reject the whole extraction.
        """
        selected = {PurePosixPath(_package_path(path)): PurePosixPath(path).name for path in paths}
        sizes = dict.fromkeys(selected, 0)
        counts = dict.fromkeys(selected, 0)
        with TemporaryFile() as archive:
            self._git.run(
                "archive", "--format=tar", "--prefix=snapshot/", self.commit, "--",
                *(str(path) for path in selected), output=archive.fileno(),
            )
            archive.seek(0)
            with tarfile.open(fileobj=archive, mode="r:") as tar:
                for member in tar:
                    parts = PurePosixPath(member.name).parts[1:]
                    if not parts:
                        continue
                    relative = PurePosixPath(*parts)
                    root = next(
                        (path for path in selected if relative == path or path in relative.parents),
                        None,
                    )
                    if root is None:
                        continue
                    if member.name.startswith("/") or any(
                        part in ("", ".", "..") for part in parts
                    ) or any(char in member.name for char in ("\\", ":", "\x00")):
                        raise ValueError(f"{root} contains an unsafe file name")
                    if not (member.isfile() or member.isdir()):
                        raise ValueError(
                            f"{root} contains a link or special file ({relative}); "
                            "only regular files are imported"
                        )
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
        # A path naming a submodule or a link archives as no folder at all.
        for path, name in selected.items():
            if not (destination / name).is_dir():
                raise ValueError(f"The repository has no folder {path}")


@contextmanager
def snapshot(repository: Repository, commit: str, key: str | None) -> Generator[Snapshot]:
    """Fetch exactly one commit, shallowly, into a temporary repository."""
    if not _COMMIT.fullmatch(commit):
        raise ValueError("Unknown commit")
    with _git(repository, key) as git:
        git.run("init", "--quiet", "--bare", str(git.directory))
        git.run("fetch", "--quiet", "--depth=1", "--no-tags", "--", git.remote, commit)
        size = git.run("count-objects", "-v").decode("ascii", "replace")
        packed = re.search(r"size-pack: (\d+)", size)
        if packed and int(packed[1]) * 1024 > MAX_FETCH_BYTES:
            raise ValueError("The repository is too large to import from")
        yield Snapshot(git, commit)


def index_schema() -> dict[str, object]:
    """The JSON Schema published for ``robozium.json``."""
    return RepositoryIndex.model_json_schema(by_alias=True)
