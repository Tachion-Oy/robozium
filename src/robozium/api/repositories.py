"""A capability repository on GitHub, and the packages its index lists.

The provider's ``robozium.json`` decides which folders are packages; nothing from
it is kept here. Git runs with an empty home and no user configuration, so it
never uses anyone's own credentials. A private repository is read over SSH with a
read-only deploy key, checked against GitHub's published host keys.
"""

import json
import os
import re
import shlex
import shutil
import subprocess
import textwrap
from keyword import iskeyword
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from urllib.parse import urlsplit

from robozium.api.errors import RepositoryUnavailableError
from robozium.hub import environment as env

INDEX_FILE = "robozium.json"
MAX_INDEX_BYTES = 64 * 1024
MAX_REPOSITORY_BYTES = 4 * env.MAX_PACKAGE_BYTES
_TIMEOUT_S = 300
# Options for every git command; tests add ones that reach local repositories.
GIT_CONFIG = ["protocol.allow=never", "protocol.https.allow=always"]
# https://api.github.com/meta "ssh_keys"; GitHub announces any change in advance.
_KNOWN_HOSTS = """\
github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
github.com ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
github.com ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
"""
_PRIVATE_KEY = re.compile(r"-----BEGIN (OPENSSH|RSA|EC) PRIVATE KEY-----(.*?)-----END \1 PRIVATE KEY-----", re.S)


class Repository:
    """One GitHub repository, read anonymously or with a read-only deploy key.

    ``fetch`` downloads only ``robozium.json`` and the folders it lists, then copies
    them. Git runs with an empty home and no user configuration.
    """

    def __init__(self, url: str, key: str | None = None) -> None:
        self.url = url.strip()
        parts = urlsplit(self.url)
        segments = parts.path.strip("/").split("/")
        # The name a repository is known by: the last part of its URL.
        self.name = re.sub(r"[^a-z0-9]", "_", segments[-1].removesuffix(".git").lower()).strip("_")
        if (
            (parts.scheme, parts.netloc, parts.query, parts.fragment) != ("https", "github.com", "", "")
            or len(segments) != 2
            or not all(re.fullmatch(r"[A-Za-z0-9._-]{1,100}", part) for part in segments)
            or not self.name
        ):
            raise ValueError("Enter a GitHub repository URL such as https://github.com/owner/repo")
        self.key = self._normalized(key) if key else None
        self._remote = f"git@github.com:{parts.path.strip('/')}" if self.key else self.url

    def fetch(self, destination: Path) -> list[str]:
        """Copy every package the index lists into ``destination/<folder name>``.

        The clone is shallow and blob-filtered, and only the listed folders are
        checked out. A deploy key exists on disk only while git runs.
        """
        git = shutil.which("git")
        if git is None:
            raise RepositoryUnavailableError("git is missing from the backend image")
        with TemporaryDirectory(prefix="robozium-git-") as folder:
            home = Path(folder)
            checkout = home / "checkout"
            inside = (git, home, "-C", str(checkout))
            if self.key:
                (home / "known_hosts").write_text(_KNOWN_HOSTS)
                (home / "deploy_key").touch(mode=0o600)
                (home / "deploy_key").write_text(self.key)
            try:
                self._run(git, home, "clone", "--quiet", "--depth=1", "--no-tags",
                          "--filter=blob:none", "--no-checkout", "--", self._remote, str(checkout))
                if not self._run(*inside, "ls-tree", "--name-only", "HEAD", "--", INDEX_FILE).strip():
                    raise ValueError(f"The repository has no {INDEX_FILE} at its root")
                paths = self._index(self._run(*inside, "show", f"HEAD:{INDEX_FILE}"))
                self._run(*inside, "sparse-checkout", "set", "--stdin", stdin="\n".join(paths) + "\n")
                self._run(*inside, "checkout", "--quiet")
            finally:
                (home / "deploy_key").unlink(missing_ok=True)
            self._copy(checkout, paths, destination)
        return sorted(child.name for child in destination.iterdir())

    def _run(self, git: str, home: Path, *args: str, stdin: str | None = None) -> str:
        """Run git in ``home``; with a deploy key, over SSH to GitHub's pinned host keys."""
        options = GIT_CONFIG
        environment = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home),
                       "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                       "GIT_TERMINAL_PROMPT": "0"}
        if self.key:
            options = [*GIT_CONFIG, "protocol.ssh.allow=always"]
            environment["GIT_SSH_COMMAND"] = shlex.join([
                "ssh", "-F", "/dev/null", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                "-o", f"UserKnownHostsFile={home / 'known_hosts'}",
                "-o", "IdentitiesOnly=yes", "-i", str(home / "deploy_key"),
            ])
        config = [argument for option in options for argument in ("-c", option)]
        try:
            result = subprocess.run(
                [git, *config, *args], input=stdin, env=environment, capture_output=True,
                text=True, timeout=_TIMEOUT_S, check=False,
            )
        except subprocess.TimeoutExpired:
            raise RepositoryUnavailableError("GitHub took too long to answer. Try again.") from None
        if not result.returncode:
            return result.stdout
        if "passphrase" in result.stderr:
            raise ValueError("Use a deploy key without a passphrase")
        if "Host key verification failed" in result.stderr:
            raise RepositoryUnavailableError("GitHub's host key did not match. Do not retry on this network.")
        if any(text in result.stderr for text in (
            "Permission denied", "not found", "Authentication failed", "could not read Username",
            "does not appear to be a git repository",
        )):
            raise ValueError(f"GitHub did not allow access to {self.url}. Check the URL"
                             + (" and that this deploy key is added to the repository." if self.key else "."))
        raise RepositoryUnavailableError(f"Could not read {self.url} from GitHub. Check the connection.")

    @staticmethod
    def _normalized(key: str) -> str:
        """Canonical lines of a private key; pasting into one line drops its breaks."""
        match = _PRIVATE_KEY.fullmatch(key.strip())
        body = re.sub(r"\s", "", match[2]) if match else ""
        if not match or not re.fullmatch(r"[A-Za-z0-9+/=]+", body):
            raise ValueError("Paste the whole private deploy key, including its BEGIN and END lines")
        label = f"{match[1]} PRIVATE KEY"
        return "\n".join([f"-----BEGIN {label}-----", *textwrap.wrap(body, 70), f"-----END {label}-----", ""])

    @staticmethod
    def _index(content: str) -> list[str]:
        """Check the provider's index; it lists package folders by path."""
        if len(content) > MAX_INDEX_BYTES:
            raise ValueError(f"The {INDEX_FILE} file is too large")
        try:
            index = json.loads(content)
        except ValueError:
            raise ValueError(f"{INDEX_FILE} is not valid JSON") from None
        paths = index.get("packages") if isinstance(index, dict) else None
        if not isinstance(paths, list) or not paths or not all(isinstance(path, str) for path in paths):
            raise ValueError(f'{INDEX_FILE} must contain "packages": a list of package folder paths')
        names = []
        for path in paths:
            parts = PurePosixPath(path).parts
            if (
                not parts or path != PurePosixPath(path).as_posix() or path.startswith("/")
                or any(part in (".", "..") for part in parts) or "\\" in path
            ):
                raise ValueError(f"{path} must be a relative folder inside the repository")
            if not parts[-1].isidentifier() or iskeyword(parts[-1]):
                raise ValueError(f"Package folder {parts[-1]!r} must be a valid Python package name")
            names.append(parts[-1])
        if len(set(names)) != len(names):
            raise ValueError(f"Package folder names in {INDEX_FILE} must be unique")
        return paths

    @staticmethod
    def _copy(checkout: Path, paths: list[str], destination: Path) -> None:
        """Copy the checked-out folders, refusing links, special files and oversized packages."""
        total = 0
        for path in paths:
            source = checkout / path
            if not source.resolve().is_relative_to(checkout.resolve()) or not source.is_dir():
                raise ValueError(f"The repository has no folder {path}")
            size = 0
            for item in source.rglob("*"):
                if item.is_symlink() or not (item.is_file() or item.is_dir()):
                    raise ValueError(f"{path} contains a link or special file; only regular files are imported")
                size += item.stat().st_size if item.is_file() else 0
            total += size
            if size > env.MAX_PACKAGE_BYTES or total > MAX_REPOSITORY_BYTES:
                raise ValueError(f"{path} is too large to import")
            shutil.copytree(source, destination / PurePosixPath(path).name)
