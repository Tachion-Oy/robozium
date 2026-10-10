"""Exercise the shipped launchers with disposable external tools."""

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
    checkout = tmp_path / "checkout with spaces"
    checkout.mkdir()
    for name in ("start", "process-compose.yaml", "compose.yaml"):
        shutil.copy2(ROOT / name, checkout / name)
    shutil.copytree(ROOT / "scripts", checkout / "scripts")
    tools = tmp_path / "bin"
    tools.mkdir()
    # Keep optional executables on the host out of the test's PATH.
    for name in ("sh", "bash", "cp", "dirname", "mkdir", "rmdir", "sed", "printenv", "id", "uname", "sleep", "cat", "chmod", "rm", "mv", "cmp"):
        executable = shutil.which(name)
        assert executable, name
        (tools / name).symlink_to(executable)
    if SUPERVISOR:
        (tools / "process-compose").symlink_to(SUPERVISOR)
    docker = tools / "docker"
    docker.write_text(
        "#!/bin/sh\n"
        "set -eu\n"
        "if [ \"$1\" = info ]; then printf '[]\\n'; exit 0; fi\n"
        "[ \"$1\" = compose ] || exit 9\n"
        "case \"$*\" in *'config --environment')\n"
        "  hub=\n"
        "  local_dirs=\n"
        "  env_source=.env.encrypt\n"
        "  case \"$*\" in *'--env-file .runtime/env-control/candidate'*) env_source=.runtime/env-control/candidate;; esac\n"
        "  for file in \"$env_source\" .env; do\n"
        "    if [ -f \"$file\" ]; then\n"
        "      value=$(sed -n \"s/^ROBOZIUM_HUB_ROOT='\\(.*\\)'$/\\1/p\" \"$file\")\n"
        "      if [ -n \"$value\" ]; then hub=$value; fi\n"
        "      value=$(sed -n \"s/^ROBOZIUM_LOCAL_DIRS='\\(.*\\)'$/\\1/p\" \"$file\")\n"
        "      if [ -n \"$value\" ]; then local_dirs=$value; fi\n"
        "    fi\n"
        "  done\n"
        "  printf 'ROBOZIUM_HUB_ROOT=%s\\n' \"${ROBOZIUM_HUB_ROOT:-$hub}\"\n"
        "  printf 'ROBOZIUM_LOCAL_DIRS=%s\\n' \"${ROBOZIUM_LOCAL_DIRS-$local_dirs}\"\n"
        "  exit 0;; esac\n"
        "case \"$*\" in *' ps '*) [ \"${TEST_DOCKER_WAIT:-}\" != 1 ] || printf 'synthetic\\n'; exit 0;; esac\n"
        "case \"$*\" in *' stop') printf stopped > \"$TEST_DOCKER_STOPPED\"; exit 0;; esac\n"
        "printf '%s\\n' \"$@\" > \"$TEST_DOCKER_ARGS\"\n"
        "printf '%s\\n' \"$ROBOZIUM_HOST_HUB_DIR\" > \"$TEST_DOCKER_HUB\"\n"
        "printf '%s\\n' \"$ROBOZIUM_MODE\" > \"$TEST_DOCKER_MODE\"\n"
        "if [ \"${TEST_DOCKER_WAIT:-}\" = 1 ]; then\n"
        "  : > \"$TEST_DOCKER_READY\"\n"

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
        "cat > \"$UV_PROJECT_ENVIRONMENT/bin/roboz\" <<'SCRIPT'\n"
        "#!/bin/sh\n"
        "[ \"$1\" = scripts ] && [ \"$2\" = serve ] || exit 8\n"
        "printf '%s\\n' \"$ROBOZIUM_HOST_HUB_DIR\" > \"$TEST_SIDECAR_HUB\"\n"
        "printf 'started\\n' >> \"$TEST_SIDECAR_STARTS\"\n"
        "printf '%s\\n' \"${OPENROUTER_API_KEY-unset}\" > \"$TEST_SIDECAR\"\n"
        "if [ \"${TEST_SIDECAR_FAIL:-}\" = startup ]; then exit 7; fi\n"
        "if [ \"${TEST_SIDECAR_DELAY:-}\" = 1 ]; then sleep 2; fi\n"
        ": > \"$TEST_SOCKET_MARKER\"\n"
        "trap 'rm -f \"$TEST_SOCKET_MARKER\"; exit 0' TERM INT\n"
        "if [ \"${TEST_SIDECAR_FAIL:-}\" = crash ]; then sleep 1; exit 7; fi\n"
        "while :; do sleep 1 & wait $! || :; done\n"
        "SCRIPT\n"
        "chmod +x \"$UV_PROJECT_ENVIRONMENT/bin/roboz\"\n"
    )
    uv.chmod(0o755)
    env = {
        **os.environ,
        "PATH": str(tools),
        "TEST_DOCKER_ARGS": str(tmp_path / "docker-args"),
        "TEST_DOCKER_HUB": str(tmp_path / "docker-hub"),
        "TEST_DOCKER_MODE": str(tmp_path / "docker-mode"),
        "TEST_SIDECAR_HUB": str(tmp_path / "sidecar-hub"),
        "TEST_DOCKER_READY": str(tmp_path / "docker-ready"),
        "TEST_DOCKER_STOPPED": str(tmp_path / "docker-stopped"),
        "TEST_SOCKET_MARKER": str(tmp_path / "socket-marker"),
        "TEST_SIDECAR_STARTS": str(tmp_path / "sidecar-starts"),
        "TEST_SIDECAR": str(tmp_path / "sidecar-secret"),
        "TEST_EXAMPLE_READY": str(tmp_path / "example-ready"),
        "PC_LOG_FILE": str(tmp_path / "supervisor.log"),
    }
    for name in ("ROBOZIUM_HUB_ROOT", "ROBOZIUM_LOCAL_DIRS", "OPENROUTER_API_KEY", "TEST_DOCKER_WAIT"):
        env.pop(name, None)
    return checkout, env


@pytest.fixture
def host_launch(launch):
    if not SUPERVISOR:
        pytest.skip("Optional host-process integration needs Process Compose v1.122.0")
    return launch


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
    assert Path(env["TEST_DOCKER_ARGS"]).read_text().splitlines()[-7:] == [
        "up", "--build", "--wait", "--wait-timeout", "180", "api", "web"
    ]
    assert not Path(env["TEST_SIDECAR_STARTS"]).exists()
    assert Path(env["TEST_DOCKER_MODE"]).read_text().strip() == "mock"
    assert not (checkout / ".runtime/host-scripts-venv").exists()
    assert not (checkout / ".runtime/launch.lock").exists()


@pytest.mark.skipif(not shutil.which("pwsh"), reason="PowerShell is not installed")
def test_powershell_mock_launcher_passes_compose_arguments_and_mounts(launch, tmp_path):
    checkout, env = launch
    catalogue = tmp_path / "customer tools"
    catalogue.mkdir()
    (checkout / ".env.encrypt").write_text(f"ROBOZIUM_LOCAL_DIRS='{catalogue}'\n")
    result = subprocess.run(
        [shutil.which("pwsh"), "-NoProfile", "-File", str(checkout / "scripts/start-mock.ps1")],
        cwd=checkout, env=env, text=True, capture_output=True, timeout=25,
    )
    assert result.returncode == 0, result.stderr
    args = Path(env["TEST_DOCKER_ARGS"]).read_text().splitlines()
    assert args[-7:] == ["up", "--build", "--wait", "--wait-timeout", "180", "api", "web"]
    assert Path(env["TEST_DOCKER_MODE"]).read_text().strip() == "mock"
    overlay = yaml.safe_load((checkout / ".runtime/capability-mounts.yaml").read_text())
    assert overlay["services"]["api"]["volumes"][0]["source"] == str(catalogue)
    assert Path(env["TEST_DOCKER_STOPPED"]).exists()


def test_launcher_creates_directories_and_preserves_private_files(launch):
    checkout, env = launch
    assert _run(checkout, env, "--mock").returncode == 0
    assert (checkout / "local/tools").is_dir()
    assert (checkout / "local/skills").is_dir()
    assert not list((checkout / "local").rglob("*.py"))
    registration = checkout / "local/__init__.py"
    registration.write_text("# Private source must survive restart\n")
    assert _run(checkout, env, "--mock").returncode == 0
    assert registration.read_text() == "# Private source must survive restart\n"


def test_live_uses_explicit_sidecar_and_encrypted_settings(host_launch, tmp_path):
    checkout, env = host_launch
    hub = tmp_path / 'Hub with "quotes" and spaces'
    (checkout / ".env.encrypt").write_text(
        f"ROBOZIUM_HUB_ROOT='{hub}'\n"
        "OPENROUTER_API_KEY_ENCRYPTED='roboz:synthetic'\n"
    )
    env["TEST_SIDECAR_DELAY"] = "1"
    result = _run(checkout, env)
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_SIDECAR_HUB"]).read_text().strip() == str(hub)
    assert Path(env["TEST_SIDECAR_STARTS"]).read_text().splitlines() == ["started"]
    assert Path(env["TEST_SIDECAR"]).read_text().strip() == "unset"
    assert Path(env["TEST_DOCKER_MODE"]).read_text().strip() == "live"
    assert "--env-file\n.env.encrypt" in Path(env["TEST_DOCKER_ARGS"]).read_text()
    assert not (checkout / ".runtime/launch.lock").exists()


def test_plaintext_takes_precedence_for_host_path(launch, tmp_path):
    checkout, env = launch
    (checkout / ".env.encrypt").write_text("ROBOZIUM_HUB_ROOT='../Wrong Hub'\n")
    (checkout / ".env").write_text("ROBOZIUM_HUB_ROOT='../Right Hub'\n")
    result = _run(checkout, env)
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_DOCKER_HUB"]).read_text().strip() == "../Right Hub"
    assert Path(env["TEST_DOCKER_ARGS"]).read_text().splitlines()[:5] == [
        "compose", "--env-file", ".env.encrypt", "--env-file", ".env"
    ]


@pytest.mark.parametrize("mode", [(), ("--mock",)])
def test_launchers_mount_extra_directories_from_dotenv_and_clear_removed_roots(launch, tmp_path, mode):
    checkout, env = launch
    first, second = tmp_path / "customer tools", tmp_path / 'shared "tools"'
    first.mkdir()
    second.mkdir()
    (first / "private.py").write_text("# keep private source\n")
    (checkout / ".env.encrypt").write_text("ROBOZIUM_LOCAL_DIRS='../wrong'\n")
    (checkout / ".env").write_text(f"ROBOZIUM_LOCAL_DIRS='../customer tools;{second};{first};local'\n")
    result = _run(checkout, env, *mode)
    assert result.returncode == 0, result.stderr
    overlay = checkout / ".runtime/capability-mounts.yaml"
    api = yaml.safe_load(overlay.read_text())["services"]["api"]
    assert [mount["source"] for mount in api["volumes"]] == [str(first), str(second)]
    assert all(mount["read_only"] and not mount["bind"]["create_host_path"] for mount in api["volumes"])
    assert api["environment"]["ROBOZIUM_LOCAL_DIRS"] == (
        "/app/.runtime/capability-roots/0;/app/.runtime/capability-roots/1"
    )
    assert (first / "private.py").read_text() == "# keep private source\n"
    assert "-f\n.runtime/capability-mounts.yaml" in Path(env["TEST_DOCKER_ARGS"]).read_text()
    env["ROBOZIUM_LOCAL_DIRS"] = ""
    assert _run(checkout, env, *mode).returncode == 0
    api = yaml.safe_load(overlay.read_text())["services"]["api"]
    assert not api.get("volumes")
    assert api["environment"]["ROBOZIUM_LOCAL_DIRS"] == ""


@pytest.mark.parametrize("mode", [(), ("--mock",)])
def test_missing_extra_directory_starts_configuration_mode(launch, mode):
    checkout, env = launch
    (checkout / ".env").write_text("ROBOZIUM_LOCAL_DIRS='../missing'\n")
    result = _run(checkout, env, *mode)
    assert result.returncode == 0
    assert "ROBOZIUM_LOCAL_DIRS directory does not exist" in result.stderr
    assert Path(env["TEST_DOCKER_ARGS"]).exists()
    assert yaml.safe_load((checkout / ".runtime/capability-mounts.yaml").read_text())["services"]["api"]["environment"]["ROBOZIUM_LOCAL_DIRS"] == ""
    assert not (checkout / ".runtime/launch.lock").exists()


def test_mock_ignores_missing_live_sidecar_prerequisites(launch):
    checkout, env = launch
    (checkout / ".env.encrypt").write_text("OPENROUTER_API_KEY_ENCRYPTED='roboz:synthetic'\n")
    (checkout / ".runtime/mock-hub/readonly/safe-scripts").mkdir(parents=True)
    (Path(env["PATH"].split(os.pathsep)[0]) / "uv").unlink()
    (Path(env["PATH"]) / "process-compose").unlink(missing_ok=True)
    result = _run(checkout, env, "--mock")
    assert result.returncode == 0, result.stderr
    assert not Path(env["TEST_SIDECAR_STARTS"]).exists()


@pytest.mark.parametrize("missing", ["process-compose", "uv", "failed-supervisor"])
def test_live_ignores_unavailable_optional_processes(launch, missing):
    checkout, env = launch
    tools = Path(env["PATH"])
    if missing == "failed-supervisor":
        supervisor = tools / "process-compose"
        supervisor.unlink(missing_ok=True)
        supervisor.write_text("#!/bin/sh\nexit 7\n")
        supervisor.chmod(0o755)
    else:
        (tools / missing).unlink(missing_ok=True)
    (checkout / ".env.encrypt").write_text("ROBOZIUM_HUB_ROOT='../Live Hub'\n")
    result = _run(checkout, env)
    assert result.returncode == 0, result.stderr
    assert Path(env["TEST_DOCKER_HUB"]).read_text().strip() == "../Live Hub"
    assert (checkout.parent / "Live Hub/readonly/safe-scripts").is_dir()
    assert not Path(env["TEST_SIDECAR_STARTS"]).exists()
    assert not (checkout / ".runtime/launch.lock").exists()


def test_invalid_storage_stops_before_application(launch):
    checkout, env = launch
    (checkout / ".runtime").mkdir()
    (checkout / ".runtime/mock-hub").write_text("keep me")
    result = _run(checkout, env, "--mock")
    assert result.returncode != 0
    assert not Path(env["TEST_DOCKER_ARGS"]).exists()
    assert (checkout / ".runtime/mock-hub").read_text() == "keep me"


def test_new_sidecar_needs_only_yaml_declaration(host_launch):
    checkout, env = host_launch
    config_path = checkout / "process-compose.yaml"
    config = yaml.safe_load(config_path.read_text())
    config["processes"]["example"] = {
        "namespace": "live-Linux",
        "command": 'sh -c \': > "$$TEST_EXAMPLE_READY"; trap "exit 0" TERM INT; while :; do sleep 1 & wait $$! || :; done\'',
        "readiness_probe": {"exec": {"command": 'test -f "$$TEST_EXAMPLE_READY"'}, "period_seconds": 1},
        "availability": {"restart": "exit_on_failure"},
    }
    config_path.write_text(yaml.safe_dump(config))
    env["TEST_DOCKER_WAIT"] = "1"
    env["TEST_SIDECAR_FAIL"] = "startup"
    process = subprocess.Popen(
        [str(checkout / "start")], cwd=checkout, env=env,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        _wait_for(Path(env["TEST_DOCKER_READY"]), process)
        _wait_for(Path(env["TEST_EXAMPLE_READY"]), process)
        assert process.poll() is None
        os.kill(process.pid, signal.SIGINT)
        process.communicate(timeout=12)
        assert Path(env["TEST_DOCKER_STOPPED"]).exists()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)


@pytest.mark.parametrize("failure", ["startup", "crash"])
def test_sidecar_failure_is_bounded_and_keeps_dependency_ui_available(host_launch, failure):
    checkout, env = host_launch
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


@pytest.mark.parametrize("shutdown_signal", [signal.SIGINT, signal.SIGTERM])
@pytest.mark.parametrize("args", [(), ("--mock",)])
def test_application_exit_and_duplicate_launch_cleanup(launch, shutdown_signal, args):
    checkout, env = launch
    env["TEST_DOCKER_WAIT"] = "1"
    process = subprocess.Popen(
        [str(checkout / "start"), *args], cwd=checkout, env=env,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        _wait_for(Path(env["TEST_DOCKER_READY"]), process)
        duplicate = _run(checkout, env, *args)
        assert duplicate.returncode != 0
        assert process.poll() is None
        os.kill(process.pid, shutdown_signal)
        process.communicate(timeout=12)
        assert process.returncode == 128 + shutdown_signal
        assert Path(env["TEST_DOCKER_STOPPED"]).exists()
        assert not (checkout / ".runtime/launch.lock").exists()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=5)


@pytest.mark.parametrize("args", [(), ("--mock",)])
def test_compose_exit_status_is_reported(launch, args):
    checkout, env = launch
    env["TEST_DOCKER_EXIT"] = "17"
    result = _run(checkout, env, *args)
    assert result.returncode == 17


def test_launcher_applies_encrypted_candidate_and_recovers_from_invalid_folder(launch):
    from robozium.settings.environment import (
        EnvironmentEdit,
        EnvironmentRow,
        EnvironmentStore,
    )

    checkout, env = launch
    env["TEST_DOCKER_WAIT"] = "1"
    process = subprocess.Popen(
        [str(checkout / "start"), "--mock"], cwd=checkout, env=env,
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    try:
        _wait_for(Path(env["TEST_DOCKER_READY"]), process)
        control = checkout / ".runtime/env-control"
        store = EnvironmentStore(checkout, control=control)
        store.save(EnvironmentEdit(revision=store.snapshot()["revision"], entries=[
            EnvironmentRow(name="ODD", value="dummy-secret", secret=True),
        ], password="test-password"))
        deadline = time.monotonic() + 12
        while store.operation() != "applied" and time.monotonic() < deadline:
            assert process.poll() is None
            time.sleep(0.05)
        assert store.operation() == "applied"
        saved = (checkout / ".env.encrypt").read_bytes()
        assert b"dummy-secret" not in saved and b"ODD_ENCRYPTED" in saved
        assert not (checkout / ".env").exists()
        store.save(EnvironmentEdit(revision=store.snapshot()["revision"], entries=[
            EnvironmentRow(name="ODD", secret=True),
            EnvironmentRow(name="ROBOZIUM_LOCAL_DIRS", value="../missing"),
        ], password="test-password"))
        deadline = time.monotonic() + 12
        while not store.operation().startswith("failed") and time.monotonic() < deadline:
            assert process.poll() is None
            time.sleep(0.05)
        assert store.operation() == "failed_configuration"
        assert (checkout / ".env.encrypt").read_bytes() == saved
    finally:
        process.terminate()
        process.communicate(timeout=12)
