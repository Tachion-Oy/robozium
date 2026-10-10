"""Services and disposable hub for Playwright and runner infrastructure checks."""

import json
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from tests.support.browser.seed import seed_conversations
from tests.support.processes import ready, stop

ROOT = Path(__file__).resolve().parents[3]


def build_frontend(env: dict[str, str], reports: Path) -> None:
    """Build once for an invocation, or validate its explicitly reused build."""
    reports.mkdir(parents=True, exist_ok=True)
    if env.get("ROBOZIUM_E2E_PREBUILT") == "1":
        if not (ROOT / "web/.next/BUILD_ID").is_file():
            raise RuntimeError("ROBOZIUM_E2E_PREBUILT requires a frontend build")
        return
    with (reports / "build.log").open("w") as log, termination_signals():
        build = subprocess.Popen(
            ["npm", "run", "build"],
            cwd=ROOT / "web",
            env=env
            | {
                "ROBOZIUM_API_BASE_URL": f"http://127.0.0.1:{env.get('ROBOZIUM_E2E_API_PORT', '8000')}"
            },
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
        try:
            if build.wait(timeout=180) != 0:
                raise RuntimeError(f"Frontend build failed; inspect {log.name}")
        finally:
            stop(build)


@contextmanager
def termination_signals() -> Iterator[None]:
    def interrupted(signum: int, _frame: object) -> None:
        # Unwind service cleanup and stop the entire browser invocation.
        raise KeyboardInterrupt(f"signal {signum}")

    previous = {
        sig: signal.signal(sig, interrupted) for sig in (signal.SIGTERM, signal.SIGINT)
    }
    try:
        yield
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)


class BrowserSession:
    def __init__(self, workspace: Path, reports: Path, env: dict[str, str]) -> None:
        self.workspace = workspace
        self.reports = reports
        self.env = {
            k: v
            for k, v in env.items()
            if k not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
        }
        self.processes: list[subprocess.Popen] = []
        self.backend: subprocess.Popen | None = None
        self.frontend: subprocess.Popen | None = None
        self.browser: subprocess.Popen | None = None
        self.output_thread: threading.Thread | None = None

    def launch(self, command: list[str], cwd: Path, log: str) -> subprocess.Popen:
        with (self.reports / log).open("a") as output:
            process = subprocess.Popen(
                command,
                cwd=cwd,
                env=self.env,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        self.processes.append(process)
        return process

    def prepare(self) -> None:
        api_port = int(self.env.get("ROBOZIUM_E2E_API_PORT", "8000"))
        web_port = int(self.env.get("ROBOZIUM_E2E_WEB_PORT", "3100"))
        if api_port == web_port:
            raise ValueError("API and web ports must differ")
        for port in (api_port, web_port):
            with socket.socket() as probe:
                probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                probe.bind(("127.0.0.1", port))
        hub = self.workspace / "hub_data"
        project = hub / "projects/e2e-project"
        logs = project / "conversation_logs"
        snapshots = project / "conversation_snapshots"
        memory = project / "persistent_memory"
        for path in (logs, snapshots, memory):
            path.mkdir(parents=True)
        config = self.workspace / "hub.config.py"
        config.write_text(
            (ROOT / "hub.config.py").read_text()
            + "\nfrom dataclasses import replace\nfrom pathlib import Path\n"
            + "SANDBOX = replace(SANDBOX, root=Path('hub_data'))\n"
            + "LOGGING = replace(LOGGING, path=Path('technical_logs/backend.jsonl'))\n"
        )
        self.env.update(
            {
                "ROBOZIUM_CONFIG": str(config),
                "ROBOZIUM_ENV_ROOT": str(self.workspace),
                "ROBOZIUM_ENCRYPTED_ENV_PATH": str(self.workspace / ".env.encrypt"),
                "ROBOZIUM_E2E_HUB_BASE_DIR": str(hub),
                "ROBOZIUM_E2E_CONVERSATION_LOGS_DIR": str(logs),
                "ROBOZIUM_E2E_SNAPSHOT_DIR": str(snapshots),
                "ROBOZIUM_E2E_MEMORY_DIR": str(memory),
                "ROBOZIUM_E2E_PROJECT_SLUG": "e2e-project",
                "ROBOZIUM_E2E_SEED_CONVERSATION_ID": "seed-conversation",
                "ROBOZIUM_E2E_OLDEST_SEED_PATH": str(logs / "seed-001.json"),
                "ROBOZIUM_API_BASE_URL": f"http://127.0.0.1:{api_port}",
                "ROBOZIUM_E2E_WEB_PORT": str(web_port),
                "ROBOZIUM_E2E_CONTROL_DIR": str(self.workspace),
                "ROBOZIUM_E2E_REPORT_DIR": str(self.reports),
                "PLAYWRIGHT_HTML_OPEN": "never",
                "NEXT_TELEMETRY_DISABLED": "1",
            }
        )
        seed_conversations(logs, "seed-conversation")
        if not (ROOT / "web/.next/BUILD_ID").is_file():
            raise RuntimeError("A production frontend build is required")

    def start_backend(self) -> subprocess.Popen:
        python = str(Path(self.env["ROBOZIUM_E2E_PYTHON"]).absolute())
        backend = self.launch(
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
                self.env["ROBOZIUM_API_BASE_URL"].rsplit(":", 1)[1],
            ],
            self.workspace,
            "backend.log",
        )
        (self.workspace / "backend.pid").write_text(str(backend.pid))
        ready(
            backend,
            self.env["ROBOZIUM_API_BASE_URL"] + "/ready",
            float(self.env.get("ROBOZIUM_API_READY_TIMEOUT_SECONDS", "60")),
        )
        return backend

    def stream_output(self) -> None:
        assert self.browser is not None and self.browser.stdout is not None
        with (
            self.browser.stdout,
            (self.reports / "playwright.log").open("a", buffering=1) as log,
        ):
            for line in self.browser.stdout:
                log.write(line)
                print(line, end="", flush=True)

    def start(self, args: list[str]) -> None:
        self.backend = self.start_backend()
        self.frontend = self.launch(
            [
                "node",
                "node_modules/next/dist/bin/next",
                "start",
                "--hostname",
                "127.0.0.1",
                "--port",
                self.env["ROBOZIUM_E2E_WEB_PORT"],
            ],
            ROOT / "web",
            "frontend.log",
        )
        ready(self.frontend, f"http://127.0.0.1:{self.env['ROBOZIUM_E2E_WEB_PORT']}")
        self.browser = subprocess.Popen(
            ["node", "node_modules/@playwright/test/cli.js", "test", *args],
            cwd=ROOT / "web",
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        self.processes.append(self.browser)
        self.output_thread = threading.Thread(target=self.stream_output, daemon=True)
        self.output_thread.start()
        print(
            f"Services ready; browser output: {self.reports / 'playwright.log'}",
            flush=True,
        )

    def wait(self) -> int:
        assert (
            self.browser is not None
            and self.backend is not None
            and self.frontend is not None
        )
        timeout = float(self.env.get("ROBOZIUM_E2E_DEADLINE_SECONDS", "0"))
        deadline = time.monotonic() + timeout if timeout else None
        while self.browser.poll() is None:
            if deadline is not None and time.monotonic() >= deadline:
                raise TimeoutError("Browser suite exceeded its runner deadline")
            if (self.workspace / "restart.request").exists():
                (self.workspace / "restart.request").unlink()
                stop(self.backend, crash=True)
                self.backend = self.start_backend()
                (self.workspace / "restart.done").write_text("ready")
            if self.backend.poll() is not None or self.frontend.poll() is not None:
                raise RuntimeError("A service exited during browser tests")
            time.sleep(0.1)
        return self.browser.returncode

    def close(self) -> list[str]:
        errors = []
        for process in reversed(self.processes):
            try:
                stop(process)
            except Exception as error:
                errors.append(f"stop {process.pid}: {error}")
        if self.output_thread:
            self.output_thread.join(timeout=10)
            if self.output_thread.is_alive():
                errors.append("browser output thread did not finish")
        try:
            if (self.workspace / "technical_logs").exists():
                shutil.copytree(
                    self.workspace / "technical_logs", self.reports / "technical_logs"
                )
        except OSError as error:
            errors.append(f"copy technical logs: {error}")
        return errors


def run_browser(args: list[str], reports: Path, env: dict[str, str]) -> int:
    reports.mkdir(parents=True, exist_ok=True)
    print(f"E2E diagnostics: {reports}", flush=True)
    status, runner_error, deadline_reached = 1, None, False
    with (
        tempfile.TemporaryDirectory(
            prefix="robozium-e2e-", dir=env.get("RUNNER_TEMP", "/tmp")
        ) as directory,
        termination_signals(),
    ):
        session = BrowserSession(Path(directory), reports, env)
        try:
            session.prepare()
            session.start(args)
            status = session.wait()
        except BaseException as error:
            runner_error = f"{type(error).__name__}: {error}"
            deadline_reached = isinstance(
                error, TimeoutError
            ) and "runner deadline" in str(error)
            (reports / "failure.txt").write_text(runner_error + "\n")
            if not isinstance(error, Exception):
                raise
        finally:
            cleanup_errors = session.close()
            result = {
                "status": status,
                "runner_error": runner_error,
                "deadline_reached": deadline_reached,
                "cleanup_errors": cleanup_errors,
                "workspace": directory,
                "processes": [
                    {"pid": p.pid, "returncode": p.poll()} for p in session.processes
                ],
            }
            (reports / "result.json").write_text(json.dumps(result, indent=2))
    return 1 if runner_error or cleanup_errors else status
