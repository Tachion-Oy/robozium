"""Exercise the port's public-API composition, not only construction shapes."""

import json
import os
import subprocess
import sys
from dataclasses import replace
from threading import Event, Thread
from types import SimpleNamespace

import pytest
from deployment_support import configured_deployment
from roboshed.capabilities import Compactification, FileCommands, FileEditing
from roboshed.tools.compactification import CompactifyStatus
from roboz.exceptions import LLMCallTimeoutError
from roboz.llm import LLMEndpoint, MockLLMEndpoint, estimate_conversation_tokens
from roboz.models import MessageKind
from roboz.runtime.events import MessageEvent

from robosprawl.hub.utils import load_hub


def _compaction_project(tmp_path):
    config = load_hub()
    project = replace(
        config, sandbox=replace(config.sandbox, root=tmp_path / "sandbox")
    ).project("compaction-test")
    project.root.mkdir(parents=True)
    return project


def _write_action():
    return {
        "action": "apply_patch",
        # Trigger compaction with removable history, leaving enough context for
        # the preserved system prompt and the bounded continuation payload.
        "rationale": "record progress " * 1000,
        "path": "projects/compaction-test/note.txt",
        "old_string": "",
        "new_string": "work in progress",
    }


def test_orchestrator_compacts_with_shed_and_persists_summary(tmp_path):
    project = _compaction_project(tmp_path)
    events = []
    endpoint = MockLLMEndpoint(
        [
            _write_action(),
            {"value": "Keep editing the local file."},
            {"action": "stop", "rationale": "done", "value": "done"},
        ],
        max_context_tokens=10000,
    )
    deployment = configured_deployment(project, endpoint, event_sinks=(events.append,))
    deployment.additional_capabilities = (Compactification(threshold_percent=60),)
    deployment.agent = replace(
        deployment.agent,
        background_agents=(),
        capabilities=(
            deployment.agent.capabilities[0],
            FileCommands(project.sandbox.permissions(), auto_load_skill=False),
            FileEditing(project.sandbox.permissions(), auto_load_skill=False),
        ),
    )
    agent, _ = deployment.build()
    assert [tool.OutputModel for tool in agent.default_tools] == [CompactifyStatus]
    result, messages = agent.invoke()
    assert result.value == "done"
    assert (project.root / "note.txt").read_text() == "work in progress"
    assert messages[0].message_kind == MessageKind.SYSTEM_MESSAGE
    compacted = next(
        m for m in messages if m.message_kind == MessageKind.COMPACTED_CONTEXT
    )
    payload = json.loads(compacted.content)
    assert payload["caller"] == "compactify_messages_when_needed"
    assert payload["threshold_percent"] == 60
    assert payload["summary_markdown"] == "Keep editing the local file."
    assert estimate_conversation_tokens(messages) < endpoint.max_context_tokens * 0.6
    statuses = [
        json.loads(event.message.content)
        for event in events
        if isinstance(event, MessageEvent)
        and event.message.content.startswith("{")
        and '"compaction_summary"' in event.message.content
    ]
    assert any(
        s["compaction_summary"] == payload["summary_markdown"] and s["compactions"] == 1
        for s in statuses
    )
    logs = [json.loads(path.read_text()) for path in project.logs.rglob("*.json")]
    assert len(logs) == 1 and logs[0]["status"] == "completed"
    assert any(
        '"compaction_summary": "Keep editing the local file."' in row["content"]
        for row in logs[0]["messages"]
    )
    sequences = [event.sequence for event in events]
    assert sequences == sorted(set(sequences))


@pytest.mark.parametrize("control", ["cancel", "timeout"])
def test_orchestrator_controls_reach_compaction_provider(tmp_path, control):
    project = _compaction_project(tmp_path)
    started, release, finished = Event(), Event(), Event()
    calls = []

    def create(**request):
        calls.append(request)
        if len(calls) == 1:
            value = _write_action()
        else:
            started.set()
            release.wait(timeout=5)
            finished.set()
            value = {"value": "late summary"}
        return SimpleNamespace(
            usage=None,
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps(value)),
                )
            ],
        )

    endpoint = LLMEndpoint(
        client=SimpleNamespace(
            chat=SimpleNamespace(completions=SimpleNamespace(create=create))
        ),
        api_name="test",
        model_name="compaction",
        max_context_tokens=10000,
        stream=False,
    )
    deployment = configured_deployment(project, endpoint)
    deployment.additional_capabilities = (
        Compactification(threshold_percent=60, timeout_s=0.1 if control == "timeout" else None),
    )
    deployment.agent = replace(
        deployment.agent,
        background_agents=(),
        capabilities=(
            deployment.agent.capabilities[0],
            FileCommands(project.sandbox.permissions(), auto_load_skill=False),
            FileEditing(project.sandbox.permissions(), auto_load_skill=False),
        ),
    )
    agent, _ = deployment.build()
    errors = []

    def invoke():
        try:
            agent.invoke()
        except Exception as error:
            errors.append(error)

    caller = Thread(target=invoke)
    caller.start()
    try:
        assert started.wait(timeout=2)
        original = list(agent.messages)
        if control == "cancel":
            agent.pipe.cancel()
        caller.join(timeout=2)
        assert not caller.is_alive()
        assert not finished.is_set()
        assert agent.messages == original
        assert not any(
            m.message_kind == MessageKind.COMPACTED_CONTEXT for m in agent.messages
        )
        if control == "timeout":
            assert len(errors) == 1 and isinstance(errors[0], LLMCallTimeoutError)
        else:
            assert errors == []
        logs = [json.loads(path.read_text()) for path in project.logs.rglob("*.json")]
        assert len(logs) == 1
        assert logs[0]["status"] == ("cancelled" if control == "cancel" else "failed")
    finally:
        release.set()
        caller.join(timeout=2)
        assert finished.wait(timeout=2)


def test_file_agent_loads_memory_writes_project_and_denies_escape(tmp_path):
    config = load_hub()
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
    deployment = configured_deployment(project, endpoint)
    deployment.agent = replace(deployment.agent, background_agents=())
    agent, _ = deployment.build()
    result, messages = agent.invoke()
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
from roboshed.deployments.robosprawl import RoboSprawl

def reject(*args, **kwargs):
    raise AssertionError('live deployment constructed')
RoboSprawl.__call__ = reject
from robosprawl.api.app import mock_app
from fastapi.testclient import TestClient
with TestClient(mock_app()) as client:
    assert client.get('/ready').status_code == 200
    import logging
    from robosprawl.hub.utils import load_hub
    assert any(getattr(handler, "baseFilename", None) == str(load_hub().logging.path) for handler in logging.getLogger("robosprawl").handlers)
    records = client.get('/admin/dependencies').json()
    assert {row['dependency_id'] for row in records if row['kind'] == 'model_endpoint'} == {model['model_id'] for model in client.get('/models').json()['models']}
""",
        ],
        env={
            key: value
            for key, value in os.environ.items()
            if key not in {"OPENAI_API_KEY", "OPENROUTER_API_KEY", "CEREBRAS_API_KEY"}
        },
        check=True,
    )
