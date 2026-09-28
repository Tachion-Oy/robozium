"""Exercise the shipped launchers with Process Compose and disposable external tools."""

import os
import shutil
import signal
import subprocess
import time
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
SUPERVISOR = shutil.which("process-compose")


@pytest.fixture
def launch(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    assert SUPERVISOR, "Install Process Compose v1.122.0 for launcher tests"
    checkout = tmp_path / "checkout with spaces"
    checkout.mkdir()
    for name in ("start", "process-compose.yaml", "compose.yaml"):
        shutil.copy2(ROOT / name, checkout / name)
    shutil.copytree(ROOT / "scripts", checkout / "scripts")
    tools = tmp_path / "bin"
    tools.mkdir()
    (tools / "process-compose").symlink_to(SUPERVISOR)
    docker = tools / "docker"
    docker.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        "if [ \"$1\" = info ]; then printf '[]\\n'; exit 0; fi\n"
        "[ \"$1\" = compose ] || exit 9\n"
        "printf '%s\\n' \"$@\" > \"$TEST_DOCKER_ARGS\"\n"
        "if [ \"${TEST_REQUIRE_EXAMPLE:-}\" = 1 ]; then [ -f \"$TEST_EXAMPLE_READY\" ] || exit 8; fi\n"
        "if [ \"${TEST_DOCKER_WAIT:-}\" = 1 ]; then\n"
        "  : > \"$TEST_DOCKER_READY\"\n"
        "  trap 'printf stopped > \"$TEST_DOCKER_STOPPED\"; exit 0' TERM INT\n"
        "  while :; do sleep 1 & wait $! || :; done\n"
        "fi\n"
        "sleep 0.5\n"
        "exit \"${TEST_DOCKER_EXIT:-0}\"\n"
    )
    docker.chmod(0o755)
    uv = tools / "uv"
    uv.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        "mkdir -p \"$UV_PROJECT_ENVIRONMENT/bin\"\n"
        "cat > \"$UV_PROJECT_ENVIRONMENT/bin/python\" <<'SCRIPT'\n"
        "#!/bin/sh\n"
        "[ \"$3\" = serve ] || exit 8\n"
        "printf '%s\\n' \"$ROBOZIUM_HOST_HUB_DIR\" > \"$TEST_SIDECAR_HUB\"\n"
        "printf 'started\\n' >> \"$TEST_SIDECAR_STARTS\"\n"
        "printf '%s\\n' \"${OPENROUTER_API_KEY_SECRET-unset}\" > \"$TEST_SIDECAR_SECRET\"\n"
        "if [ \"${TEST_SIDECAR_FAIL:-}\" = startup ]; then exit 7; fi\n"
        "if [ \"${TEST_SIDECAR_DELAY:-}\" = 1 ]; then sleep 2; fi\n"
        ": > \"$TEST_SOCKET_MARKER\"\n"
        "trap 'rm -f \"$TEST_SOCKET_MARKER\"; exit 0' TERM INT\n"
        "if [ \"${TEST_SIDECAR_FAIL:-}\" = crash ]; then sleep 1; exit 7; fi\n"
        "while :; do sleep 1 & wait $! || :; done\n"
        "SCRIPT\n"
        "chmod +x \"$UV_PROJECT_ENVIRONMENT/bin/python\"\n"
    )
    uv.chmod(0o755)
    env = {
        **os.environ,
        "PATH": f"{tools}:{os.environ['PATH']}",
        "TEST_DOCKER_ARGS": str(tmp_path / "docker-args"),
        "TEST_SIDECAR_HUB": str(tmp_path / "sidecar-hub"),
        "TEST_DOCKER_READY": str(tmp_path / "docker-ready"),
        "TEST_DOCKER_STOPPED": str(tmp_path / "docker-stopped"),
        "TEST_SOCKET_MARKER": str(tmp_path / "socket-marker"),
        "TEST_SIDECAR_STARTS": str(tmp_path / "sidecar-starts"),
        "TEST_SIDECAR_SECRET": str(tmp_path / "sidecar-secret"),
        "TEST_EXAMPLE_READY": str(tmp_path / "example-ready"),
        "PC_LOG_FILE": str(tmp_path / "supervisor.log"),
    }
    for name in ("ROBOZIUM_HUB_ROOT", "OPENROUTER_API_KEY_SECRET", "TEST_DOCKER_WAIT"):
        env.pop(name, None)
    return checkout, env


def _run(checkout: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(checkout / "start"), *args],
        cwd=checkout,
        env=env,
        text=True,
        capture_output=True,
        timeout=25,
    )


def _wait_for(path: Path, process: subprocess.Popen[str], timeout: float = 12) -> None:
    deadline = time.monotonic() + timeout
    while not path.exists() and time.monotonic() < deadline:
        assert process.poll() is None
        time.sleep(0.05)
    assert path.exists()


def test_argument_validation_and_mock_isolation(launch):
    checkout, env = launch
    for args in (("bad",), ("--mock", "extra")):
        result = _run(checkout, env, *args)
        assert result.returncode == 2
        assert "Usage:" in result.stderr
    result = _run(checkout, env, "--mock")
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_DOCKER_ARGS"]).read_text().splitlines()[-4:] == [
        "up", "--build", "--exit-code-from", "api"
    ]
    assert not Path(env["TEST_SIDECAR_STARTS"]).exists()
    assert not (checkout / ".runtime/host-scripts-venv").exists()
    assert not (checkout / ".runtime/launch.lock").exists()


def test_live_uses_explicit_sidecar_and_encrypted_settings(launch, tmp_path):
    checkout, env = launch
    hub = tmp_path / 'Hub with "quotes" and spaces'
    (checkout / ".env.encrypt").write_text(
        f"ROBOZIUM_HUB_ROOT='{hub}'\n"
        "OPENROUTER_API_KEY_SECRET='roboz:synthetic'\n"
    )
    env["TEST_SIDECAR_DELAY"] = "1"
    result = _run(checkout, env)
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_SIDECAR_HUB"]).read_text().strip() == str(hub)
    assert Path(env["TEST_SIDECAR_STARTS"]).read_text().splitlines() == ["started"]
    assert Path(env["TEST_SIDECAR_SECRET"]).read_text().strip() == "unset"
    assert "--env-file\n.env.encrypt" in Path(env["TEST_DOCKER_ARGS"]).read_text()
    assert not (checkout / ".runtime/launch.lock").exists()


def test_plaintext_takes_precedence_for_host_path(launch, tmp_path):
    checkout, env = launch
    (checkout / ".env.encrypt").write_text("ROBOZIUM_HUB_ROOT='../Wrong Hub'\n")
    (checkout / ".env").write_text("ROBOZIUM_HUB_ROOT='../Right Hub'\n")
    result = _run(checkout, env)
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_SIDECAR_HUB"]).read_text().strip() == "../Right Hub"
    assert Path(env["TEST_DOCKER_ARGS"]).read_text().splitlines()[:5] == [
        "compose", "--env-file", ".env.encrypt", "--env-file", ".env"
    ]


def test_mock_ignores_missing_live_sidecar_prerequisites(launch):
    checkout, env = launch
    (checkout / ".env.encrypt").write_text("OPENROUTER_API_KEY_SECRET='roboz:synthetic'\n")
    (checkout / ".runtime/mock-hub/readonly/safe-scripts").mkdir(parents=True)
    (Path(env["PATH"].split(os.pathsep)[0]) / "uv").unlink()
    result = _run(checkout, env, "--mock")
    assert result.returncode == 0, result.stderr
    assert not Path(env["TEST_SIDECAR_STARTS"]).exists()


def test_invalid_storage_stops_before_application(launch):
    checkout, env = launch
    (checkout / ".runtime").mkdir()
    (checkout / ".runtime/mock-hub").write_text("keep me")
    result = _run(checkout, env, "--mock")
    assert result.returncode != 0
    assert not Path(env["TEST_DOCKER_ARGS"]).exists()
    assert (checkout / ".runtime/mock-hub").read_text() == "keep me"


def test_new_sidecar_needs_only_yaml_declaration_and_dependency(launch):
    checkout, env = launch
    config_path = checkout / "process-compose.yaml"
    config = yaml.safe_load(config_path.read_text())
    config["processes"]["example"] = {
        "command": 'sh -c \': > "$$TEST_EXAMPLE_READY"; trap "exit 0" TERM INT; while :; do sleep 1 & wait $$! || :; done\'',
        "readiness_probe": {"exec": {"command": 'test -f "$$TEST_EXAMPLE_READY"'}, "period_seconds": 1},
        "availability": {"restart": "exit_on_failure"},
    }
    config["processes"]["live-Linux"]["depends_on"]["example"] = {
        "condition": "process_healthy"
    }
    config_path.write_text(yaml.safe_dump(config))
    env["TEST_REQUIRE_EXAMPLE"] = "1"
    result = _run(checkout, env)
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_EXAMPLE_READY"]).exists()


@pytest.mark.parametrize("failure", ["startup", "crash"])
def test_sidecar_failure_is_bounded_and_keeps_dependency_ui_available(launch, failure):
    checkout, env = launch
    env["TEST_DOCKER_WAIT"] = "1"
    env["TEST_SIDECAR_FAIL"] = failure
    process = subprocess.Popen(
        [str(checkout / "start")], cwd=checkout, env=env,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        _wait_for(Path(env["TEST_DOCKER_READY"]), process)
        deadline = time.monotonic() + 12
        starts = Path(env["TEST_SIDECAR_STARTS"])
        while time.monotonic() < deadline:
            assert process.poll() is None
            if starts.exists() and len(starts.read_text().splitlines()) == 3:
                break
            time.sleep(0.1)
        time.sleep(2)
        assert len(starts.read_text().splitlines()) == 3
        assert process.poll() is None
        os.kill(process.pid, signal.SIGINT)
        process.communicate(timeout=12)
        assert Path(env["TEST_DOCKER_STOPPED"]).exists()
        assert not (checkout / ".runtime/launch.lock").exists()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)


def test_application_exit_and_duplicate_launch_cleanup(launch):
    checkout, env = launch
    env["TEST_DOCKER_WAIT"] = "1"
    process = subprocess.Popen(
        [str(checkout / "start"), "--mock"], cwd=checkout, env=env,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        _wait_for(Path(env["TEST_DOCKER_READY"]), process)
        duplicate = _run(checkout, env, "--mock")
        assert duplicate.returncode != 0
        assert process.poll() is None
        os.kill(process.pid, signal.SIGINT)
        process.communicate(timeout=12)
        assert Path(env["TEST_DOCKER_STOPPED"]).exists()
        assert not (checkout / ".runtime/launch.lock").exists()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)


def test_compose_exit_status_is_reported(launch):
    checkout, env = launch
    env["TEST_DOCKER_EXIT"] = "17"
    result = _run(checkout, env, "--mock")
    assert result.returncode == 17
