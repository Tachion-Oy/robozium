"""Validate app archives and install candidate wheels with pip outside sources."""

import argparse
import email
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path

from roboz_wheels import verify_wheels

ROOT = Path(__file__).resolve().parents[1]


def validate(wheel: Path) -> None:
    with zipfile.ZipFile(wheel) as archive:
        names = archive.namelist()
        metadata = email.message_from_bytes(
            archive.read(next(n for n in names if n.endswith("/METADATA")))
        )
        assert metadata["Name"] == "robozium"
        assert metadata["License-Expression"] == "Apache-2.0"
        assert any(n.endswith(".dist-info/licenses/LICENSE") for n in names)
        assert all(n.startswith(("robozium/", "robozium-")) for n in names)
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
        and not k.startswith("PIP_")
    }
    env["PIP_CONFIG_FILE"] = os.devnull
    dependencies = verify_wheels(dist)
    with tempfile.TemporaryDirectory(
        prefix="robozium-install-", dir=os.environ.get("RUNNER_TEMP", "/tmp")
    ) as directory:
        root = Path(directory)
        env["ROBOZIUM_CONFIG"] = str(root / "hub.config.py")
        # Installed checks must not inherit a source checkout's pytest options,
        # including when RUNNER_TEMP is placed inside that checkout.
        (root / "pytest.ini").write_text("[pytest]\n")

        def run(*command):
            subprocess.run(command, cwd=root, env=env, check=True)

        original = next(dist.glob("robozium-*.whl"))
        validate(original)
        with tarfile.open(next(dist.glob("robozium-*.tar.gz"))) as archive:
            names = [Path(name).parts[1:] for name in archive.getnames()]
            allowed = {
                "src",
                "README.md",
                "CHANGELOG.md",
                "LICENSE",
                "pyproject.toml",
                "hub.config.py",
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
        unit_tests = root / "tests/unit"
        unit_tests.mkdir(parents=True)
        for filename in ("test_local_capabilities.py", "config_support.py"):
            shutil.copyfile(ROOT / "tests/unit" / filename, unit_tests / filename)
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
                "--isolated",
                "install",
                "--index-url",
                "https://pypi.org/simple/",
                str(wheel),
                *(str(p) for p in dependencies),
                "pytest",
            )
            run(str(python), "-I", "-m", "pip", "check")
            (root / "hub.config.py").write_text(
                (ROOT / "hub.config.py").read_text()
                + "\nfrom dataclasses import replace\nfrom pathlib import Path\n"
                + "SANDBOX = replace(SANDBOX, root=Path('hub_data'))\n"
                + "LOGGING = replace(LOGGING, path=Path('technical_logs/backend.jsonl'))\n"
            )
            shutil.copyfile(
                ROOT / "tests/unit/test_port_composition.py",
                root / "test_composition.py",
            )
            shutil.copyfile(
                ROOT / "tests/unit/deployment_support.py", root / "deployment_support.py"
            )
            shutil.copyfile(ROOT / "scripts/installed_smoke.py", root / "smoke.py")
            try:
                run(
                    str(python),
                    "-I",
                    "-m",
                    "pytest",
                    "--noconftest",
                    "-c",
                    str(root / "pytest.ini"),
                    "-q",
                    str(root / "test_composition.py"),
                    str(unit_tests / "test_local_capabilities.py"),
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
