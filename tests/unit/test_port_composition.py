"""Exercise the port's public-API composition, not only construction shapes."""

import json
import os
import subprocess
import sys
from dataclasses import replace

from roboz import All, Message, Role
from roboz.llm import MockLLMEndpoint
from roboz.models import MessageKind
from roboz.runtime import Output

from robosprawl.compaction import get_compactify_messages_when_needed_tool
from robosprawl.composition import AgenticFactory, OrchestratorConstructor
from robosprawl.hub import load_hub_config


def test_compaction_preserves_bootstrap_and_replaces_history():
    endpoint = MockLLMEndpoint(
        [{"value": "Keep editing the local file."}], max_context_tokens=20
    )
    compact = get_compactify_messages_when_needed_tool(
        endpoint=endpoint, threshold_percent=50
    )
    bootstrap = Message(
        role=Role.SYSTEM, content="System", message_kind=MessageKind.SYSTEM_MESSAGE
    )
    messages = [bootstrap, Message(role=Role.USER, content="Work in progress. " * 50)]
    compact(input=All(), messages=messages)
    assert messages[0] is bootstrap
    assert len(messages) == 2
    assert messages[1].message_kind == MessageKind.COMPACTED_CONTEXT
    assert (
        json.loads(messages[1].content)["summary_markdown"]
        == "Keep editing the local file."
    )


def test_file_agent_loads_memory_writes_project_and_denies_escape(tmp_path):
    config = load_hub_config()
    project = replace(
        config, sandbox=replace(config.sandbox, root=tmp_path / "sandbox")
    ).project("patch-test")
    project.memory.mkdir(parents=True)
    (project.memory / "memory.md").write_text("REMEMBER-LOCAL-MARKER")
    outside = tmp_path / "outside.txt"
    outside.write_text("untouched")
    endpoint = MockLLMEndpoint(
        [
            {
                "action": "apply_patch",
                "rationale": "write project",
                "path": "projects/patch-test/note.txt",
                "old_string": "",
                "new_string": "hello",
            },
            {
                "action": "apply_patch",
                "rationale": "attempt escape",
                "path": str(outside),
                "old_string": "",
                "new_string": "changed",
            },
            {"action": "stop", "rationale": "done", "value": "done"},
        ]
    )
    bundle = AgenticFactory(
        orchestrator=OrchestratorConstructor(
            agent_endpoint=endpoint, extra_default_tools=()
        ),
        interaction_mode=Output.API,
    )(project, event_sinks=())
    result, messages = bundle.agent.invoke()
    assert result.value == "done"
    assert (project.root / "note.txt").read_text() == "hello"
    assert outside.read_text() == "untouched"
    logs = list(project.logs.rglob("*.json"))
    assert logs
    assert "REMEMBER-LOCAL-MARKER" in logs[0].read_text()


def test_mock_import_never_constructs_live_deployment():
    subprocess.run(
        [
            sys.executable,
            "-c",
            """
import robosprawl.deployment as deployment

def reject(*args, **kwargs):
    raise AssertionError('live deployment constructed')
deployment.HubDeployment.standard = reject
from robosprawl.api.app import mock_app
from fastapi.testclient import TestClient
with TestClient(mock_app()) as client:
    assert client.get('/ready').status_code == 200
    import logging
    from robosprawl.hub import load_hub_config
    assert any(getattr(handler, "baseFilename", None) == str(load_hub_config().logging.path) for handler in logging.getLogger("robosprawl").handlers)
    assert all(row['kind'] == 'executable' for row in client.get('/admin/dependencies').json())
""",
        ],
        env={
            key: value
            for key, value in os.environ.items()
            if key not in {"OPENAI_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY"}
        },
        check=True,
    )
