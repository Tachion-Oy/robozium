"""The live deployment uses RoboZ's host script transport and event pipe."""

import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Event

import pytest
from deployment_support import configured_deployment
from roboz.exceptions import ExternalCallCancelledError
from roboz.llm import MockLLMEndpoint
from roboz.runtime.events import ScriptOutputEvent
from roboz.shed.tools.safe_scripts import RunShellScriptInput, ScriptSocketDependency

from robozium.hub.utils import load_hub


@pytest.mark.skipif(sys.platform != "linux", reason="host socket requires Linux")
def test_discovery_execution_and_output_use_the_configured_host(tmp_path, monkeypatch):
    hub_root = tmp_path / "hub"
    scripts = hub_root / "readonly/safe-scripts"
    (scripts / "example").mkdir(parents=True)
    (scripts / "other").mkdir()
    (scripts / "other/announce.sh").write_text("#!/bin/bash\necho other\n")
    (scripts / "example/write.sh").write_text(
        "#!/bin/bash\n# Write a host marker.\n"
        "echo first\nprintf marker > marker.txt\necho last\n"
    )
    (scripts / "example/fail.sh").write_text("#!/bin/bash\necho problem\nexit 7\n")
    (scripts / "example/cancel.sh").write_text(
        "#!/bin/bash\necho ready\nsleep 2\nprintf leaked > leaked.txt\n"
    )
    outside = tmp_path / "outside.sh"
    outside.write_text("#!/bin/bash\necho escaped\n")
    (scripts / "alias.sh").symlink_to(outside)
    socket_dir = tmp_path / "socket"
    socket_dir.mkdir(mode=0o700)
    socket_path = socket_dir / "scripts.sock"
    monkeypatch.setenv("ROBOZIUM_HOST_SCRIPT_SOCKET", str(socket_path))
    with (tmp_path / "helper.log").open("w+") as log:
        process = subprocess.Popen(
            [
                str(Path(sys.executable).with_name("roboz")),
                "scripts",
                "serve",
                "--socket",
                str(socket_path),
                "--scripts",
                str(scripts),
                "--cwd",
                str(hub_root),
            ],
            stdout=log,
            stderr=log,
        )
        try:
            deadline = time.monotonic() + 5
            dependency = ScriptSocketDependency(socket_path)
            while time.monotonic() < deadline and process.poll() is None:
                if dependency.check() is None:
                    break
                time.sleep(0.02)
            assert dependency.check() is None, log.read()
            hub = load_hub()
            project = hub.project("scripts")
            events = []
            started = Event()

            def sink(event):
                events.append(event)
                if isinstance(event, ScriptOutputEvent) and "ready" in event.content:
                    started.set()

            agent, _ = configured_deployment(
                project, MockLLMEndpoint([]), event_sinks=(sink,)
            )
            tool = next(tool for tool in agent.tools if tool.name == "run_shell_script")
            assert dependency in tool.external_dependencies()
            listed = tool(RunShellScriptInput(), [])
            assert [(entry.script, entry.description) for entry in listed.scripts] == [
                ("example/cancel.sh", ""),
                ("example/fail.sh", ""),
                ("example/write.sh", "Write a host marker."),
                ("other/announce.sh", ""),
            ]
            assert tool(RunShellScriptInput(script="other/announce.sh"), []).status == (
                "success"
            )
            assert tool(RunShellScriptInput(script="../outside.sh"), []).status == "refused"
            assert tool(RunShellScriptInput(script="alias.sh"), []).status == "refused"
            result = tool(RunShellScriptInput(script="example/write.sh"), [])
            assert (result.status, result.exit_code) == ("success", 0)
            assert (hub_root / "marker.txt").read_text() == "marker"
            assert "first" in "".join(
                event.content for event in events if isinstance(event, ScriptOutputEvent)
            )
            failure = tool(RunShellScriptInput(script="example/fail.sh"), [])
            assert (failure.status, failure.exit_code) == ("failed", 7)
            assert "problem" in failure.output
            with ThreadPoolExecutor(max_workers=1) as executor:
                pending = executor.submit(
                    tool, RunShellScriptInput(script="example/cancel.sh"), []
                )
                assert started.wait(timeout=3)
                agent.pipe.cancel()
                with pytest.raises(ExternalCallCancelledError):
                    pending.result(timeout=3)
            time.sleep(2.1)
            assert not (hub_root / "leaked.txt").exists()
        finally:
            process.terminate()
            process.wait(timeout=8)
    assert process.returncode == 0
    assert not socket_path.exists()
