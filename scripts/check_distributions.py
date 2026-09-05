"""Validate app archives and install candidate wheels with pip outside sources."""

import argparse
import email
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def validate(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        metadata = email.message_from_bytes(
            archive.read(next(n for n in names if n.endswith("/METADATA")))
        )
        assert metadata["Name"] == "robosprawl"
        assert metadata["License-Expression"] == "Apache-2.0"
        assert any(n.endswith(".dist-info/licenses/LICENSE") for n in names)
        assert all(n.startswith(("robosprawl/", "robosprawl-")) for n in names)
        assert all(
            "@" not in req and "file:" not in req
            for req in metadata.get_all("Requires-Dist", [])
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dist", type=Path, required=True)
    parser.add_argument(
        "--python-output",
        type=Path,
        help="Keep an installed environment here for browser jobs; must not exist",
    )
    parser.add_argument(
        "--reports", type=Path, default=ROOT / ".artifacts/distribution-reports"
    )
    args = parser.parse_args()
    dist = args.dist.resolve()
    reports = args.reports.resolve()
    reports.mkdir(parents=True, exist_ok=True)
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
    }
    with tempfile.TemporaryDirectory(
        prefix="robosprawl-install-", dir=os.environ.get("RUNNER_TEMP", "/tmp")
    ) as directory:
        root = Path(directory)

        def run(*command):
            subprocess.run(command, cwd=root, env=env, check=True)

        original = next(dist.glob("robosprawl-*.whl"))
        validate(original)
        with tarfile.open(next(dist.glob("robosprawl-*.tar.gz"))) as archive:
            names = [Path(name).parts[1:] for name in archive.getnames()]
            allowed = {
                "src",
                "README.md",
                "CHANGELOG.md",
                "LICENSE",
                "pyproject.toml",
                "hub.config.json.example",
                "PKG-INFO",
                ".gitignore",  # Hatch includes VCS ignore rules in sdists.
            }
            assert all(not parts or parts[0] in allowed for parts in names), (
                "Unexpected source archive content"
            )
            archive.extractall(root / "source", filter="data")
        source = next((root / "source").iterdir())
        run(
            "uv",
            "build",
            "--no-sources",
            "--wheel",
            "--out-dir",
            str(root / "rebuilt"),
            str(source),
        )
        rebuilt = next((root / "rebuilt").glob("*.whl"))
        validate(rebuilt)
        dependencies = [
            next(dist.glob(pattern))
            for pattern in ("roboz-*.whl", "roboz_shed-*.whl", "roboz_openai-*.whl")
        ]
        for label, wheel in (("wheel", original), ("sdist", rebuilt)):
            venv = (
                args.python_output.resolve()
                if args.python_output and label == "wheel"
                else root / f"{label}-venv"
            )
            if venv.exists():
                raise FileExistsError(f"Installation environment must be fresh: {venv}")
            python = venv / "bin/python"
            run("uv", "venv", "--seed", "--python", sys.executable, str(venv))
            run(
                str(python),
                "-I",
                "-m",
                "pip",
                "install",
                str(wheel),
                *(str(p) for p in dependencies),
                "pytest",
            )
            run(str(python), "-I", "-m", "pip", "check")
            config = json.loads((ROOT / "hub.config.json").read_text())
            config["sandbox"]["root"] = "hub_data"
            config["logging"]["file"]["path"] = "technical_logs/backend.jsonl"
            (root / "hub.config.json").write_text(json.dumps(config))
            shutil.copyfile(
                ROOT / "tests/unit/test_port_composition.py",
                root / "test_composition.py",
            )
            shutil.copyfile(ROOT / "scripts/installed_smoke.py", root / "smoke.py")
            try:
                run(
                    str(python),
                    "-I",
                    "-m",
                    "pytest",
                    "--noconftest",
                    "-q",
                    str(root / "test_composition.py"),
                    "--junitxml=" + str(reports / f"{label}-composition.xml"),
                )
                run(str(python), "-I", str(root / "smoke.py"))
            finally:
                if (root / "backend.log").exists():
                    shutil.copyfile(
                        root / "backend.log", reports / f"{label}-backend.log"
                    )
            shutil.rmtree(root / "hub_data")


if __name__ == "__main__":
    main()
