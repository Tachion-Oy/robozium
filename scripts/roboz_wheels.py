"""Download or verify the indexed RoboZ wheel selected by uv.lock."""

import argparse
import hashlib
import json
import shutil
import tempfile
import tomllib
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = ("roboz",)
INDEX_HOSTS = {
    "https://test.pypi.org/simple": "test-files.pythonhosted.org",
    "https://pypi.org/simple": "files.pythonhosted.org",
}


def locked_wheels(lock: Path) -> list[dict[str, str]]:
    packages = tomllib.loads(lock.read_text())["package"]
    selected = []
    for name in PACKAGES:
        matches = [package for package in packages if package["name"] == name]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one locked release of {name}")
        package = matches[0]
        registry = package.get("source", {}).get("registry", "").rstrip("/")
        if registry not in INDEX_HOSTS:
            raise ValueError(f"{name} must use PyPI or TestPyPI, not a local source")
        version = package["version"]
        filename = f"{name.replace('-', '_')}-{version}-py3-none-any.whl"
        wheels = [
            wheel
            for wheel in package.get("wheels", [])
            if Path(urlparse(wheel["url"]).path).name == filename
        ]
        if len(wheels) != 1:
            raise ValueError(f"Missing unique universal wheel for {name} {version}")
        wheel = wheels[0]
        url = urlparse(wheel["url"])
        if url.scheme != "https" or url.netloc != INDEX_HOSTS[registry]:
            raise ValueError(f"Unexpected wheel host for {name}: {wheel['url']}")
        algorithm, _, digest = wheel.get("hash", "").partition(":")
        if algorithm != "sha256" or len(digest) != 64:
            raise ValueError(f"Missing SHA-256 for {name}")
        int(digest, 16)
        selected.append(
            dict(
                name=name,
                version=version,
                filename=filename,
                url=wheel["url"],
                sha256=digest,
                registry=registry,
            )
        )
    return selected


def verify_wheels(dist: Path, lock: Path = ROOT / "uv.lock") -> list[Path]:
    paths = []
    for wheel in locked_wheels(lock):
        expected = dist / wheel["filename"]
        matches = set(dist.glob(f"{wheel['name'].replace('-', '_')}-*.whl"))
        if matches != {expected}:
            raise ValueError(f"Expected only {expected.name} for {wheel['name']}")
        with expected.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != wheel["sha256"]:
            raise ValueError(f"Wheel hash does not match uv.lock: {expected.name}")
        paths.append(expected)
    return paths


def download_wheels(dist: Path, lock: Path = ROOT / "uv.lock") -> None:
    wheels = locked_wheels(lock)
    dist.mkdir(parents=True, exist_ok=True)
    for wheel in wheels:
        if list(dist.glob(f"{wheel['name'].replace('-', '_')}-*.whl")):
            raise FileExistsError(f"Dependency output must be fresh: {dist}")
    with tempfile.TemporaryDirectory(prefix="download-", dir=dist) as directory:
        staging = Path(directory)
        for wheel in wheels:
            print(
                f"Downloading {wheel['name']} {wheel['version']} from {wheel['registry']}",
                flush=True,
            )
            with urllib.request.urlopen(wheel["url"], timeout=60) as response:
                if urlparse(response.geturl()).netloc != urlparse(wheel["url"]).netloc:
                    raise ValueError(
                        f"Unexpected download redirect: {response.geturl()}"
                    )
                with (staging / wheel["filename"]).open("wb") as output:
                    shutil.copyfileobj(response, output)
        verify_wheels(staging, lock)
        for wheel in wheels:
            (staging / wheel["filename"]).rename(dist / wheel["filename"])


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=ROOT / "uv.lock")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify existing wheels without downloading",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / ".artifacts/distribution-reports/dependency-releases.json",
    )
    args = parser.parse_args()
    if not args.check:
        download_wheels(args.dist, args.lock)
    verify_wheels(args.dist, args.lock)
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(locked_wheels(args.lock), indent=2) + "\n")
    print(f"Verified indexed dependency wheels: {args.dist}")


if __name__ == "__main__":
    main()
