"""Resolve the shipped Compose file with synthetic live and mock inputs."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("mode", ["live", "mock"])
@pytest.mark.parametrize("web_port", [None, "6971"])
def test_compose_storage_and_credentials(tmp_path: Path, mode: str, web_port: str | None):
    assert shutil.which("docker"), "Docker Compose is required for deployment checks"
    shutil.copy2(ROOT / "compose.yaml", tmp_path / "compose.yaml")
    (tmp_path / ".env.encrypt").write_text(
        "OPENROUTER_API_KEY_SECRET='roboz:synthetic'\n"
        + ("ROBOZIUM_WEB_PORT='6970'\n" if web_port else "")
    )
    (tmp_path / ".env").write_text(f"ROBOZIUM_WEB_PORT='{web_port}'\n" if web_port else "")
    hub = tmp_path / ('Hub with "quotes" and spaces' if mode == "live" else ".runtime/mock-hub")
    socket = tmp_path / f".runtime/{mode}-socket"
    env = {
        **os.environ, "ROBOZIUM_MODE": mode,
        "ROBOZIUM_HOST_HUB_DIR": str(hub), "ROBOZIUM_HOST_SOCKET_DIR": str(socket),
    }
    env.pop("ROBOZIUM_WEB_PORT", None)
    env.pop("ROBOZIUM_LOCAL_DIRS", None)
    completed = subprocess.run(
        [
            "docker", "compose", "--env-file", ".env.encrypt", "--env-file", ".env",
            "-f", "compose.yaml", "--profile", "verify", "config", "--format", "json",
        ],
        cwd=tmp_path, env=env, capture_output=True, text=True, check=True,
    )
    services = json.loads(completed.stdout)["services"]
    assert set(services) == {"api", "web", "verify"}
    for service in services.values():
        assert service["network_mode"] == "host"
        assert not service.get("ports")
        assert not service.get("extra_hosts")
    api = services["api"]
    assert api["environment"]["ROBOZIUM_MODE"] == mode
    assert api["environment"]["OPENROUTER_API_KEY_SECRET"] == "roboz:synthetic"
    assert api["environment"]["ROBOZIUM_HOST_SCRIPT_SOCKET"] == "/host-scripts/scripts.sock"
    volumes = {mount["target"]: mount for mount in api["volumes"]}
    assert volumes["/hub"]["source"] == str(hub)
    assert volumes["/host-scripts"]["source"] == str(socket)
    assert volumes["/host-scripts"]["read_only"] is True
    assert volumes["/app/local"]["source"] == str(tmp_path / "local")
    assert volumes["/app/local"]["read_only"] is True
    assert volumes["/hub/readonly/safe-scripts"]["source"] == str(hub / "readonly/safe-scripts")
    assert volumes["/hub/readonly/safe-scripts"]["read_only"] is True
    assert "/app/.env.encrypt" not in volumes
    assert services["web"]["environment"] == {
        "PORT": web_port or "6969",
        "ROBOZIUM_API_BASE_URL": "http://127.0.0.1:8000",
    }
    assert services["verify"]["environment"]["ROBOZIUM_CONTAINER_BASE_URL"] == (
        f"http://127.0.0.1:{web_port or '6969'}"
    )


def test_live_launcher_resolves_settings_with_compose(tmp_path: Path):
    docker = shutil.which("docker")
    assert docker, "Docker Compose is required for deployment checks"
    checkout = tmp_path / "checkout with spaces"
    checkout.mkdir()
    for name in ("start", "compose.yaml", "process-compose.yaml"):
        shutil.copy2(ROOT / name, checkout / name)
    shutil.copytree(ROOT / "scripts", checkout / "scripts")
    tools = tmp_path / "bin"
    tools.mkdir()
    stub = tools / "docker"
    stub.write_text(
        "#!/bin/sh\n"
        "if [ \"$1\" = info ]; then printf '[]\\n'; exit 0; fi\n"
        "case \"$*\" in *'config --environment') exec \"$TEST_REAL_DOCKER\" \"$@\";; esac\n"
        "printf '%s\\n' \"$ROBOZIUM_HOST_HUB_DIR\" \"$ROBOZIUM_MODE\" \"$ROBOZIUM_API_USER\" > \"$TEST_LAUNCH\"\n"
    )
    stub.chmod(0o755)
    supervisor = tools / "process-compose"
    supervisor.write_text("#!/bin/sh\nexit 7\n")
    supervisor.chmod(0o755)
    hub = tmp_path / 'Hub with "quotes" & café'
    (checkout / ".env.encrypt").write_text(
        "ROBOZIUM_HUB_ROOT='../Wrong Hub'\nOPENROUTER_API_KEY_SECRET='roboz:synthetic'\n"
    )
    (checkout / ".env").write_text(f"ROBOZIUM_HUB_ROOT='{hub}'\nROBOZIUM_API_USER=1234:5678\n")
    output = tmp_path / "launch"
    env = {
        **os.environ, "PATH": f"{tools}:{os.environ['PATH']}",
        "TEST_REAL_DOCKER": docker, "TEST_LAUNCH": str(output),
    }
    env.pop("ROBOZIUM_HUB_ROOT", None)
    env.pop("ROBOZIUM_API_USER", None)
    completed = subprocess.run(
        [str(checkout / "start")], cwd=checkout, env=env,
        capture_output=True, text=True, timeout=15,
    )
    assert completed.returncode == 0, completed.stderr
    assert output.read_text().splitlines() == [str(hub), "live", "1234:5678"]
    assert (hub / "readonly/safe-scripts").is_dir()
    assert not (checkout / ".runtime/launch.lock").exists()


@pytest.mark.parametrize("mode", ["live", "mock"])
def test_extra_mounts_use_literal_host_paths_and_container_environment(tmp_path, mode):
    shutil.copy2(ROOT / "compose.yaml", tmp_path / "compose.yaml")
    (tmp_path / "local").mkdir()
    first, second = tmp_path / "customer tools", tmp_path / "a '$literal' folder"
    first.mkdir()
    second.mkdir()
    directories = f"customer tools;{second};{first};local"
    output = subprocess.run(
        ["sh", str(ROOT / "scripts/capability-mounts.sh"), directories],
        cwd=tmp_path, capture_output=True, text=True, check=True,
    )
    (tmp_path / "mounts.yaml").write_text(output.stdout)
    completed = subprocess.run(
        ["docker", "compose", "-f", "compose.yaml", "-f", "mounts.yaml", "config", "--format", "json"],
        cwd=tmp_path, env={**os.environ, "ROBOZIUM_MODE": mode},
        capture_output=True, text=True, check=True,
    )
    api = json.loads(completed.stdout)["services"]["api"]
    volumes = {mount["target"]: mount for mount in api["volumes"]}
    assert volumes["/app/local"]["source"] == str(tmp_path / "local")
    for index, source in enumerate((first, second)):
        mount = volumes[f"/app/.runtime/capability-roots/{index}"]
        # Compose may escape literal dollars again when serializing reusable config.
        assert mount["source"].replace("$$", "$") == str(source)
        assert mount["read_only"] is True
        assert mount["bind"].get("create_host_path", False) is False
    assert api["environment"]["ROBOZIUM_LOCAL_DIRS"] == (
        "/app/.runtime/capability-roots/0;/app/.runtime/capability-roots/1"
    )
