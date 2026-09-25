"""Own isolated backend, production frontend, browser process, and diagnostics."""

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
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
    api_port_raw = env.get("ROBOZIUM_E2E_API_PORT", "8000")
    web_port_raw = env.get("ROBOZIUM_E2E_WEB_PORT", "3100")
    python = str(Path(env.get("ROBOZIUM_E2E_PYTHON", sys.executable)).absolute())
    status = 1
    runner_error = None
    cleanup_errors = []
    deadline_reached = False
    browser_log_thread = None
    first_failure = threading.Event()

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

    def browser_output(process: subprocess.Popen) -> None:
        with (reports / "playwright.log").open("a", buffering=1) as log:
            assert process.stdout is not None
            for line in process.stdout:
                log.write(line)
                print(line, end="", flush=True)
                if "✘" in line and not first_failure.is_set():
                    first_failure.set()

    def snapshot_resources() -> None:
        with (reports / "resources.log").open("a") as log:
            log.write(f"time={time.time()}\n")
            for name, process in (
                ("backend", backend),
                ("frontend", frontend),
                ("browser", browser),
            ):
                if process is None:
                    continue
                try:
                    status_text = Path(f"/proc/{process.pid}/status").read_text()
                    selected = [
                        line
                        for line in status_text.splitlines()
                        if line.startswith(("VmRSS:", "Threads:"))
                    ]
                    log.write(
                        f"{name} pid={process.pid} returncode={process.poll()} {' '.join(selected)}\n"
                    )
                except OSError as error:
                    log.write(f"{name}: {error}\n")
            for endpoint in ("/ready", "/projects"):
                started = time.monotonic()
                try:
                    with urllib.request.urlopen(
                        env["ROBOZIUM_API_BASE_URL"] + endpoint, timeout=2
                    ) as response:
                        payload = response.read()
                        log.write(
                            f"{endpoint} status={response.status} bytes={len(payload)} seconds={time.monotonic() - started:.3f}\n"
                        )
                        if endpoint == "/projects":
                            projects = json.loads(payload)
                            log.write(
                                f"projects={len(projects)} states={[row.get('status') for row in projects]}\n"
                            )
                except Exception as error:
                    log.write(
                        f"{endpoint} error={error} seconds={time.monotonic() - started:.3f}\n"
                    )

    with tempfile.TemporaryDirectory(
        prefix="robozium-e2e-", dir=env.get("RUNNER_TEMP", "/tmp")
    ) as directory:
        workspace = Path(directory)
        try:
            api_port = int(api_port_raw)
            web_port = int(web_port_raw)
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
                    "ROBOZIUM_CONFIG": str(workspace / "hub.config.py"),
                    "ROBOZIUM_E2E_HUB_BASE_DIR": str(hub),
                    "ROBOZIUM_E2E_CONVERSATION_LOGS_DIR": str(logs),
                    "ROBOZIUM_E2E_SNAPSHOT_DIR": str(snapshots),
                    "ROBOZIUM_E2E_MEMORY_DIR": str(memory),
                    "ROBOZIUM_E2E_PROJECT_SLUG": "e2e-project",
                    "ROBOZIUM_E2E_SEED_CONVERSATION_ID": "seed-conversation",
                    "ROBOZIUM_E2E_OLDEST_SEED_PATH": str(logs / "seed-001.json"),
                    "ROBOZIUM_API_BASE_URL": f"http://127.0.0.1:{api_port}",
                    "ROBOZIUM_E2E_WEB_PORT": str(web_port),
                    "ROBOZIUM_E2E_CONTROL_DIR": str(workspace),
                    "ROBOZIUM_E2E_REPORT_DIR": str(reports),
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
            if env.get("ROBOZIUM_E2E_PREBUILT") != "1":
                build = launch(["npm", "run", "build"], ROOT / "web", "build.log")
                if build.wait(timeout=180) != 0:
                    raise RuntimeError("Frontend build failed")
            elif not (ROOT / "web/.next/BUILD_ID").is_file():
                raise RuntimeError("ROBOZIUM_E2E_PREBUILT requires web/.next/BUILD_ID")

            def start_backend() -> subprocess.Popen:
                return launch(
                    [
                        python,
                        "-I",
                        "-m",
                        "uvicorn",
                        "robozium.api.app:mock_app",
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
                env["ROBOZIUM_API_BASE_URL"] + "/ready",
                float(env.get("ROBOZIUM_API_READY_TIMEOUT_SECONDS", "60")),
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
            browser = subprocess.Popen(
                ["node", "node_modules/@playwright/test/cli.js", "test", *args],
                cwd=ROOT / "web",
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                start_new_session=True,
            )
            browser_log_thread = threading.Thread(
                target=browser_output, args=(browser,), daemon=True
            )
            browser_log_thread.start()
            print(
                f"Services ready; browser output: {reports / 'playwright.log'}",
                flush=True,
            )
            browser_deadline = (
                time.monotonic() + float(env.get("ROBOZIUM_E2E_DEADLINE_SECONDS", "0"))
                if env.get("ROBOZIUM_E2E_DEADLINE_SECONDS")
                else None
            )
            last_sample = 0.0
            sampled_failure = False
            while browser.poll() is None:
                if (
                    env.get("ROBOZIUM_E2E_RUNNER_PROBE") == "1"
                    and (workspace / "kill-backend.request").exists()
                ):
                    (workspace / "kill-backend.request").unlink()
                    stop(backend, crash=True)
                    raise RuntimeError("Probe requested backend exit")
                if (
                    browser_deadline is not None
                    and time.monotonic() >= browser_deadline
                ):
                    deadline_reached = True
                    raise TimeoutError("Browser suite exceeded its runner deadline")
                if time.monotonic() - last_sample >= 5 or (
                    first_failure.is_set() and not sampled_failure
                ):
                    snapshot_resources()
                    last_sample = time.monotonic()
                    sampled_failure |= first_failure.is_set()
                if (workspace / "restart.request").exists():
                    (workspace / "restart.request").unlink()
                    stop(backend, crash=True)
                    backend = start_backend()
                    ready(backend, env["ROBOZIUM_API_BASE_URL"] + "/ready", 60)
                    (workspace / "restart.done").write_text("ready")
                if backend.poll() is not None or frontend.poll() is not None:
                    raise RuntimeError("A service exited during browser tests")
                time.sleep(0.1)
            status = browser.returncode
        except BaseException as error:
            runner_error = f"{type(error).__name__}: {error}"
            status = (
                error.code
                if isinstance(error, SystemExit) and isinstance(error.code, int)
                else 1
            )
            (reports / "failure.txt").write_text(runner_error + "\n")
        finally:
            for process in (browser, frontend, backend, build):
                try:
                    stop(process)
                except BaseException as error:
                    cleanup_errors.append(
                        f"stop {process.pid if process else 'none'}: {error}"
                    )
            if browser_log_thread:
                browser_log_thread.join(timeout=10)
                if browser_log_thread.is_alive():
                    cleanup_errors.append("browser output thread did not finish")
            try:
                if (workspace / "technical_logs").exists():
                    shutil.copytree(
                        workspace / "technical_logs", reports / "technical_logs"
                    )
            except BaseException as error:
                cleanup_errors.append(f"copy technical logs: {error}")
            if env.get("ROBOZIUM_E2E_PROBE_CLEANUP_FAILURE") == "1":
                cleanup_errors.append("Probe requested cleanup failure")
            if cleanup_errors:
                (reports / "cleanup-failure.txt").write_text(
                    "\n".join(cleanup_errors) + "\n"
                )
            (reports / "result.json").write_text(
                json.dumps(
                    {
                        "status": status,
                        "runner_error": runner_error,
                        "deadline_reached": deadline_reached,
                        "cleanup_errors": cleanup_errors,
                        "completion_present": (reports / "completion.json").exists(),
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
            if os.environ.get("GITHUB_OUTPUT"):
                with Path(os.environ["GITHUB_OUTPUT"]).open("a") as output:
                    output.write(f"report_dir={reports}\n")
            if runner_error or cleanup_errors:
                status = 1
    return status


if __name__ == "__main__":
    (ROOT / ".artifacts/e2e").mkdir(parents=True, exist_ok=True)
    raise SystemExit(main())
