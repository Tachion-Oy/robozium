"""Install both archive formats outside the checkout and exercise their runtime."""

import email
import os
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


def run(*command: str, cwd: Path) -> None:
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV", "ROBOZIUM_CONFIG"}
    }
    subprocess.run(command, cwd=cwd, env=env, check=True)


def validate_wheel(wheel: Path) -> None:
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


@pytest.fixture(scope="session")
def candidates(tmp_path_factory):
    root = tmp_path_factory.mktemp("archives")
    dist = Path(os.environ.get("ROBOZIUM_DIST_DIR", root / "dist")).resolve()
    if "ROBOZIUM_DIST_DIR" not in os.environ:
        run("uv", "build", "--no-sources", "--out-dir", str(dist), cwd=ROOT)
    with tarfile.open(next(dist.glob("robozium-*.tar.gz"))) as archive:
        allowed = {
            "src",
            "README.md",
            "CHANGELOG.md",
            "LICENSE",
            "pyproject.toml",
            "hub.config.py",
            "PKG-INFO",
            ".gitignore",
        }
        assert all(
            len(Path(n).parts) < 2 or Path(n).parts[1] in allowed
            for n in archive.getnames()
        )
        archive.extractall(root / "source", filter="data")
    run(
        "uv",
        "build",
        "--no-sources",
        "--wheel",
        "--out-dir",
        str(root / "rebuilt"),
        str(next((root / "source").iterdir())),
        cwd=root,
    )
    requirements = root / "requirements.txt"
    run(
        "uv",
        "export",
        "--locked",
        "--no-emit-project",
        "--output-file",
        str(requirements),
        cwd=ROOT,
    )
    return {
        "wheel": next(dist.glob("robozium-*.whl")),
        "sdist": next((root / "rebuilt").glob("*.whl")),
    }, requirements


@pytest.mark.parametrize("archive", ["wheel", "sdist"])
def test_installed_candidate(archive, candidates, tmp_path):
    wheels, requirements = candidates
    validate_wheel(wheels[archive])
    environment = tmp_path / "venv"
    python = environment / "bin/python"
    run("uv", "venv", "--python", sys.executable, str(environment), cwd=tmp_path)
    run(
        "uv",
        "pip",
        "install",
        "--python",
        str(python),
        "--require-hashes",
        "--only-binary",
        "roboz",
        "-r",
        str(requirements),
        cwd=tmp_path,
    )
    run(
        "uv",
        "pip",
        "install",
        "--python",
        str(python),
        "--no-deps",
        str(wheels[archive]),
        cwd=tmp_path,
    )
    run("uv", "pip", "check", "--python", str(python), cwd=tmp_path)
    (tmp_path / "pytest.ini").write_text("[pytest]\n")
    (tmp_path / "hub.config.py").write_text(
        (ROOT / "hub.config.py").read_text()
        + "\nfrom dataclasses import replace\nfrom pathlib import Path\n"
        + "SANDBOX = replace(SANDBOX, root=Path('hub_data'))\n"
        + "LOGGING = replace(LOGGING, path=Path('technical_logs/backend.jsonl'))\n"
    )
    tests = tmp_path / "tests"
    shutil.copytree(
        ROOT / "tests/support",
        tests / "support",
        ignore=shutil.ignore_patterns("__pycache__"),
    )
    (tests / "__init__.py").touch()
    unit = tests / "unit"
    unit.mkdir()
    for name in (
        "test_port_composition.py",
        "test_local_capabilities.py",
        "config_support.py",
        "deployment_support.py",
    ):
        shutil.copyfile(ROOT / "tests/unit" / name, unit / name)
    shutil.copyfile(
        Path(__file__).with_name("installed_checks.py"), tests / "installed_checks.py"
    )
    reports = ROOT / ".artifacts/distribution-reports"
    reports.mkdir(parents=True, exist_ok=True)
    try:
        run(
            str(python),
            "-I",
            "-m",
            "pytest",
            "-c",
            str(tmp_path / "pytest.ini"),
            "-q",
            str(unit),
            str(tests / "installed_checks.py"),
            "--junitxml=" + str(reports / f"{archive}.xml"),
            cwd=tmp_path,
        )
    finally:
        if (tmp_path / "backend.log").exists():
            shutil.copyfile(
                tmp_path / "backend.log", reports / f"{archive}-backend.log"
            )
