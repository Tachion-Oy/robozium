"""Resolve the shipped Compose file with synthetic live and mock inputs."""

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("mode", ["live", "mock"])
def test_compose_storage_and_credentials(tmp_path: Path, mode: str):
    assert shutil.which("docker"), "Docker Compose is required for deployment checks"
    shutil.copy2(ROOT / "compose.yaml", tmp_path / "compose.yaml")
    (tmp_path / ".env.encrypt").write_text(
        "ROBOZIUM_WEB_PORT='6970'\nOPENROUTER_API_KEY_SECRET='roboz:synthetic'\n"
    )
    (tmp_path / ".env").write_text("ROBOZIUM_WEB_PORT='6971'\n")
    hub = tmp_path / ('Hub with "quotes" and spaces' if mode == "live" else ".runtime/mock-hub")
    socket = tmp_path / f".runtime/{mode}-socket"
    env = {
        **os.environ, "ROBOZIUM_MODE": mode,
        "ROBOZIUM_HOST_HUB_DIR": str(hub), "ROBOZIUM_HOST_SOCKET_DIR": str(socket),
    }
    env.pop("ROBOZIUM_WEB_PORT", None)
    completed = subprocess.run(
        [
            "docker", "compose", "--env-file", ".env.encrypt", "--env-file", ".env",
            "-f", "compose.yaml", "config", "--format", "json",
        ],
        cwd=tmp_path, env=env, capture_output=True, text=True, check=True,
    )
    services = json.loads(completed.stdout)["services"]
    assert set(services) == {"api", "web"}
    api = services["api"]
    assert api["environment"]["ROBOZIUM_MODE"] == mode
    assert api["environment"]["OPENROUTER_API_KEY_SECRET"] == "roboz:synthetic"
    assert api["environment"]["ROBOZIUM_HOST_SCRIPT_SOCKET"] == "/host-scripts/scripts.sock"
    volumes = {mount["target"]: mount for mount in api["volumes"]}
    assert volumes["/hub"]["source"] == str(hub)
    assert volumes["/host-scripts"]["source"] == str(socket)
    assert volumes["/host-scripts"]["read_only"] is True
    assert volumes["/hub/readonly/safe-scripts"]["source"] == str(hub / "readonly/safe-scripts")
    assert volumes["/hub/readonly/safe-scripts"]["read_only"] is True
    assert "/app/.env.encrypt" not in volumes
    assert services["web"]["ports"][0]["published"] == "6971"


def test_live_launcher_resolves_settings_with_compose(tmp_path: Path):
    docker = shutil.which("docker")
    assert docker, "Docker Compose is required for deployment checks"
    checkout = tmp_path / "checkout with spaces"
    checkout.mkdir()
    for name in ("start", "compose.yaml", "process-compose.yaml"):
        shutil.copy2(ROOT / name, checkout / name)
    shutil.copytree(ROOT / "scripts", checkout / "scripts")
    shutil.copytree(ROOT / "examples", checkout / "examples")
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
