"""The POSIX launcher keeps host storage safe before invoking Compose."""

import os
import shutil
import subprocess
from pathlib import Path

import pytest

SOURCE = Path(__file__).resolve().parents[2] / "start"


def _launcher(tmp_path: Path, *, configured_root: str = "") -> tuple[Path, dict[str, str]]:
    checkout = tmp_path / "checkout"
    checkout.mkdir()
    shutil.copy2(SOURCE, checkout / "start")
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/bin/sh\n"
        "if [ \"$1\" = info ]; then\n"
        "  printf '%s\\n' \"${TEST_DOCKER_SECURITY:-[]}\"\n"
        "  exit\n"
        "fi\n"
        "[ \"$1\" = compose ] || exit 9\n"
        "shift\n"
        ": > \"$TEST_ENV_FILES\"\n"
        "while [ \"${1:-}\" = --env-file ]; do\n"
        "  printf '%s\\n' \"$2\" >> \"$TEST_ENV_FILES\"\n"
        "  shift 2\n"
        "done\n"
        "if [ \"$1\" = config ]; then\n"
        "  printf 'ROBOZIUM_HUB_ROOT=%s\\n' \"$TEST_CONFIG_ROOT\"\n"
        "  exit\n"
        "fi\n"
        "if [ \"$1\" = -f ]; then shift 4; fi\n"
        "[ \"$1\" = up ] || exit 9\n"
        "printf '%s\\n%s\\n%s\\n%s\\n' "
        "\"$ROBOZIUM_MODE\" \"$ROBOZIUM_HOST_HUB_DIR\" "
        "\"$ROBOZIUM_HOST_LOG_DIR\" \"$ROBOZIUM_API_USER\" "
        "> \"$TEST_RESULT\"\n"
    )
    docker.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:{os.environ['PATH']}",
        "TEST_CONFIG_ROOT": configured_root,
        "TEST_ENV_FILES": str(tmp_path / "env-files"),
        "TEST_RESULT": str(tmp_path / "result"),
    }
    for variable in (
        "ROBOZIUM_HUB_ROOT",
        "ROBOZIUM_HOST_HUB_DIR",
        "ROBOZIUM_HOST_LOG_DIR",
        "ROBOZIUM_API_USER",
    ):
        env.pop(variable, None)
    return checkout, env


def test_live_launcher_reuses_sibling_hub_and_resolves_configured_path(tmp_path):
    checkout, env = _launcher(tmp_path, configured_root="../Hub with spaces")
    hub = tmp_path / "Hub with spaces"
    hub.mkdir()
    (hub / "keep.txt").write_text("existing data")
    (checkout / "local").mkdir()
    (checkout / "local/__init__.py").write_text("CAPABILITIES = ()\n")

    for _ in range(2):
        subprocess.run([str(checkout / "start")], env=env, check=True)

    assert (hub / "keep.txt").read_text() == "existing data"
    assert (checkout / "local/__init__.py").read_text() == "CAPABILITIES = ()\n"
    assert (tmp_path / "result").read_text().splitlines() == [
        "live",
        str(hub),
        str(checkout / ".runtime/logs"),
        f"{os.getuid()}:{os.getgid()}",
    ]


def test_mock_launcher_uses_checkout_runtime_and_rejects_file_path(tmp_path):
    checkout, env = _launcher(tmp_path)
    subprocess.run([str(checkout / "start"), "--mock"], env=env, check=True)
    assert (tmp_path / "result").read_text().splitlines()[:3] == [
        "mock",
        str(checkout / ".runtime/mock-hub"),
        str(checkout / ".runtime/mock-logs"),
    ]
    assert not (tmp_path / "Robozium-Hub").exists()
    assert list((checkout / "local").iterdir()) == []

    env["TEST_DOCKER_SECURITY"] = '["name=rootless"]'
    subprocess.run([str(checkout / "start"), "--mock"], env=env, check=True)
    assert (tmp_path / "result").read_text().splitlines()[-1] == "0:0"

    bad_path = tmp_path / "not-a-directory"
    bad_path.write_text("keep")
    env["ROBOZIUM_HUB_ROOT"] = str(bad_path)
    (tmp_path / "result").unlink()
    result = subprocess.run([str(checkout / "start")], env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert "not a directory" in result.stderr
    assert bad_path.read_text() == "keep"
    assert not (tmp_path / "result").exists()


def test_live_launcher_uses_encrypted_file_after_env_is_deleted(tmp_path):
    checkout, env = _launcher(tmp_path, configured_root="../Private Hub")
    (checkout / ".env.encrypt").write_text(
        "ROBOZIUM_HUB_ROOT='../Private Hub'\n"
        "ROBOZIUM_WEB_PORT='6970'\n"
        "OPENROUTER_API_KEY_SECRET='roboz:synthetic'\n"
    )
    subprocess.run([str(checkout / "start")], env=env, check=True)
    assert not (checkout / ".env").exists()
    assert (tmp_path / "env-files").read_text().splitlines() == [".env.encrypt"]
    assert (tmp_path / "result").read_text().splitlines()[1] == str(
        tmp_path / "Private Hub"
    )


def test_launcher_rejects_a_file_at_local_package_path(tmp_path):
    checkout, env = _launcher(tmp_path)
    (checkout / "local").write_text("keep private data")
    result = subprocess.run(
        [str(checkout / "start"), "--mock"], env=env, capture_output=True, text=True
    )
    assert result.returncode != 0
    assert "Local capability path is not a directory" in result.stderr
    assert (checkout / "local").read_text() == "keep private data"
    assert not (tmp_path / "result").exists()


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell is not installed")
def test_windows_launcher_preserves_local_package(tmp_path):
    checkout, env = _launcher(tmp_path)
    scripts = checkout / "scripts"
    scripts.mkdir()
    shutil.copy2(SOURCE.parent / "scripts/start.ps1", scripts / "start.ps1")
    command = ["pwsh", "-NoProfile", "-File", str(scripts / "start.ps1"), "--mock"]
    subprocess.run(command, env=env, check=True)
    entrypoint = checkout / "local/__init__.py"
    assert entrypoint.parent.is_dir()
    entrypoint.write_text("CAPABILITIES = ()\n")
    subprocess.run(command, env=env, check=True)
    assert entrypoint.read_text() == "CAPABILITIES = ()\n"
    entrypoint.unlink()
    entrypoint.parent.rmdir()
    (checkout / "local").write_text("keep private data")
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    assert result.returncode != 0
    assert "Local capability path is not a directory" in result.stderr
    assert (checkout / "local").read_text() == "keep private data"
