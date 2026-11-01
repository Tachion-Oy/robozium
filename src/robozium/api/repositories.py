"""Clone a capability repository from GitHub and copy the packages its index lists.

The provider's ``robozium.json`` decides which folders are packages; nothing from
it is kept here. Git runs with an empty home and no user configuration, so it
never uses anyone's own credentials.
"""

import json
import os
import re
import shutil
import subprocess
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


def repository_name(url: str) -> str:
    """The name a repository is known by: the last part of its URL."""
    parts = urlsplit(url.strip())
    segments = parts.path.strip("/").split("/")
    name = re.sub(r"[^a-z0-9]", "_", segments[-1].removesuffix(".git").lower()).strip("_")
    if (
        (parts.scheme, parts.netloc, parts.query, parts.fragment) != ("https", "github.com", "", "")
        or len(segments) != 2
        or not all(re.fullmatch(r"[A-Za-z0-9._-]{1,100}", part) for part in segments)
        or not name
    ):
        raise ValueError("Enter a GitHub repository URL such as https://github.com/owner/repo")
    return name


def fetch(url: str, destination: Path) -> None:
    """Copy every package the repository's index lists into ``destination/<folder name>``.

    The clone is shallow and blob-filtered, and only the listed folders are checked
    out, so nothing outside ``robozium.json`` and those folders is downloaded.
    """
    git = shutil.which("git")
    if git is None:
        raise RepositoryUnavailableError("git is missing from the backend image")
    with TemporaryDirectory(prefix="robozium-git-") as folder:
        checkout = Path(folder) / "checkout"

        def run(*args: str, stdin: str | None = None) -> str:
            return _git(git, folder, url.strip(), [*args], stdin)

        run("clone", "--quiet", "--depth=1", "--no-tags", "--filter=blob:none", "--no-checkout",
            "--", url.strip(), str(checkout))
        inside = ("-C", str(checkout))
        if not run(*inside, "ls-tree", "--name-only", "HEAD", "--", INDEX_FILE).strip():
            raise ValueError(f"The repository has no {INDEX_FILE} at its root")
        paths = _index(run(*inside, "show", f"HEAD:{INDEX_FILE}"))
        # Exact patterns, not cone mode, which would also check out every file at the
        # root and in each parent folder of a listed path.
        run(*inside, "sparse-checkout", "set", "--no-cone", "--stdin",
            stdin="".join(f"/{path}/\n" for path in paths))
        run(*inside, "checkout", "--quiet")
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


def _git(git: str, home: str, url: str, args: list[str], stdin: str | None) -> str:
    """Run git with an empty home and no user configuration."""
    config = [argument for option in GIT_CONFIG for argument in ("-c", option)]
    environment = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": home,
                   "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull,
                   "GIT_TERMINAL_PROMPT": "0"}
    try:
        result = subprocess.run(
            [git, *config, *args], input=stdin, env=environment, capture_output=True,
            text=True, timeout=_TIMEOUT_S, check=False,
        )
    except subprocess.TimeoutExpired:
        raise RepositoryUnavailableError("GitHub took too long to answer. Try again.") from None
    if result.returncode:
        if any(text in result.stderr for text in (
            "not found", "Authentication failed", "could not read Username",
            "does not appear to be a git repository",
        )):
            raise ValueError(f"GitHub did not allow access to {url}. Check the URL.")
        raise RepositoryUnavailableError(f"Could not read {url} from GitHub. Check the connection.")
    return result.stdout


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
