"""Own isolated backend, production frontend, browser process, and diagnostics."""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def stop(process: subprocess.Popen | None, *, crash: bool = False) -> None:
    if process is None:
        return
    # The leader may have exited while descendants still own ports.
    try:
        os.killpg(process.pid, signal.SIGKILL if crash else signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def ready(process: subprocess.Popen, url: str, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f"Service exited ({process.returncode}) before readiness: {url}"
            )
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.1)
    raise TimeoutError(f"Service did not become ready within {timeout}s: {url}")


def main() -> int:
    args = sys.argv[1:]

    def interrupted(signum, _frame):
        raise SystemExit(128 + signum)

    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    if not any(arg == "--project" or arg.startswith("--project=") for arg in args):
        failed = False
        for name in ("chromium", "firefox", "webkit"):
            controller = subprocess.Popen(
                [sys.executable, __file__, *args, f"--project={name}"]
            )
            try:
                failed |= controller.wait() != 0
            finally:
                if controller.poll() is None:
                    controller.terminate()
                    try:
                        controller.wait(timeout=30)
                    except subprocess.TimeoutExpired:
                        controller.kill()
                        controller.wait(timeout=5)
        return int(failed)
    reports = Path(tempfile.mkdtemp(prefix="run-", dir=ROOT / ".artifacts/e2e"))
    print(f"E2E diagnostics: {reports}", flush=True)
    backend = frontend = browser = build = None
    handles = []
    env = {
        k: v
        for k, v in os.environ.items()
        if k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
    }
    api_port = int(env.get("ROBOSPRAWL_E2E_API_PORT", "8000"))
    web_port = int(env.get("ROBOSPRAWL_E2E_WEB_PORT", "3100"))
    python = str(Path(env.get("ROBOSPRAWL_E2E_PYTHON", sys.executable)).absolute())
    status = 1

    def launch(command: list[str], cwd: Path, log: str) -> subprocess.Popen:
        handle = (reports / log).open("a")
        handles.append(handle)
        return subprocess.Popen(
            command,
            cwd=cwd,
            env=env,
            stdout=handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )

    with tempfile.TemporaryDirectory(
        prefix="robosprawl-e2e-", dir=env.get("RUNNER_TEMP", "/tmp")
    ) as directory:
        workspace = Path(directory)
        try:
            if api_port == web_port:
                raise ValueError("API and web ports must differ")
            for port in (api_port, web_port):
                with socket.socket() as probe:
                    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                    probe.bind(("127.0.0.1", port))
            hub = workspace / "hub_data"
            project = hub / "projects/e2e-project"
            logs = project / "conversation_logs"
            snapshots = project / "conversation_snapshots"
            memory = project / "persistent_memory"
            for path in (logs, snapshots, memory):
                path.mkdir(parents=True)
            (workspace / "hub.config.py").write_text(
                (ROOT / "hub.config.py").read_text()
                + "\nfrom dataclasses import replace\nfrom pathlib import Path\n"
                + "SANDBOX = replace(SANDBOX, root=Path('hub_data'))\n"
                + "LOGGING = replace(LOGGING, path=Path('technical_logs/backend.jsonl'))\n"
            )
            env.update(
                {
                    "ROBOSPRAWL_CONFIG": str(workspace / "hub.config.py"),
                    "ROBOSPRAWL_E2E_HUB_BASE_DIR": str(hub),
                    "ROBOSPRAWL_E2E_CONVERSATION_LOGS_DIR": str(logs),
                    "ROBOSPRAWL_E2E_SNAPSHOT_DIR": str(snapshots),
                    "ROBOSPRAWL_E2E_MEMORY_DIR": str(memory),
                    "ROBOSPRAWL_E2E_PROJECT_SLUG": "e2e-project",
                    "ROBOSPRAWL_E2E_SEED_CONVERSATION_ID": "seed-conversation",
                    "ROBOSPRAWL_E2E_OLDEST_SEED_PATH": str(logs / "seed-001.json"),
                    "ROBOSPRAWL_API_BASE_URL": f"http://127.0.0.1:{api_port}",
                    "ROBOSPRAWL_E2E_WEB_PORT": str(web_port),
                    "ROBOSPRAWL_E2E_CONTROL_DIR": str(workspace),
                    "ROBOSPRAWL_E2E_REPORT_DIR": str(reports),
                    "PLAYWRIGHT_HTML_OPEN": "never",
                    "NEXT_TELEMETRY_DISABLED": "1",
                }
            )
            subprocess.run(
                [python, "-I", str(Path(__file__).with_name("seed.py"))],
                cwd=workspace,
                env=env,
                check=True,
            )
            if env.get("ROBOSPRAWL_E2E_PREBUILT") != "1":
                build = launch(["npm", "run", "build"], ROOT / "web", "build.log")
                if build.wait(timeout=180) != 0:
                    raise RuntimeError("Frontend build failed")
            elif not (ROOT / "web/.next/BUILD_ID").is_file():
                raise RuntimeError(
                    "ROBOSPRAWL_E2E_PREBUILT requires web/.next/BUILD_ID"
                )

            def start_backend() -> subprocess.Popen:
                return launch(
                    [
                        python,
                        "-I",
                        "-m",
                        "uvicorn",
                        "robosprawl.api.app:mock_app",
                        "--factory",
                        "--host",
                        "127.0.0.1",
                        "--port",
                        str(api_port),
                    ],
                    workspace,
                    "backend.log",
                )

            backend = start_backend()
            ready(
                backend,
                env["ROBOSPRAWL_API_BASE_URL"] + "/ready",
                float(env.get("ROBOSPRAWL_API_READY_TIMEOUT_SECONDS", "60")),
            )
            frontend = launch(
                [
                    "node",
                    "node_modules/next/dist/bin/next",
                    "start",
                    "--hostname",
                    "127.0.0.1",
                    "--port",
                    str(web_port),
                ],
                ROOT / "web",
                "frontend.log",
            )
            ready(frontend, f"http://127.0.0.1:{web_port}", 60)
            browser = launch(
                ["node", "node_modules/@playwright/test/cli.js", "test", *args],
                ROOT / "web",
                "playwright.log",
            )
            print(
                f"Services ready; browser output: {reports / 'playwright.log'}",
                flush=True,
            )
            while browser.poll() is None:
                if (workspace / "restart.request").exists():
                    (workspace / "restart.request").unlink()
                    stop(backend, crash=True)
                    backend = start_backend()
                    ready(backend, env["ROBOSPRAWL_API_BASE_URL"] + "/ready", 60)
                    (workspace / "restart.done").write_text("ready")
                if backend.poll() is not None or frontend.poll() is not None:
                    raise RuntimeError("A service exited during browser tests")
                time.sleep(0.1)
            status = browser.returncode
            return status
        except BaseException as error:
            (reports / "failure.txt").write_text(f"{type(error).__name__}: {error}\n")
            raise
        finally:
            for process in (browser, frontend, backend, build):
                stop(process)
            if (workspace / "technical_logs").exists():
                shutil.copytree(
                    workspace / "technical_logs", reports / "technical_logs"
                )
            (reports / "result.json").write_text(
                json.dumps(
                    {
                        "status": status,
                        "workspace": str(workspace),
                        "processes": [
                            {"pid": p.pid, "returncode": p.poll()}
                            for p in (backend, frontend, browser, build)
                            if p
                        ],
                    },
                    indent=2,
                )
            )
            for handle in handles:
                handle.close()
            if (reports / "playwright.log").exists():
                print((reports / "playwright.log").read_text(), flush=True)


if __name__ == "__main__":
    (ROOT / ".artifacts/e2e").mkdir(parents=True, exist_ok=True)
    exit_code = main()
    # Exceptions (including setup, interruption, and cleanup failures) never
    # reach here. Only a completed single-browser invocation can be advisory.
    if os.environ.get("GITHUB_OUTPUT") and any(
        arg == "--project" or arg.startswith("--project=") for arg in sys.argv[1:]
    ):
        with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
            output.write(f"playwright_exit_code={exit_code}\n")
    raise SystemExit(exit_code)
