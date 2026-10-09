"""Application composition on shared definitions, without live credentials."""

import json
from dataclasses import replace
from pathlib import Path
from threading import Thread

import pytest
from deployment_support import configured_deployment, foreground_agent
from roboz.deployment import Capability, DeployableAgent, ToolLabel
from roboz.endpoints.inventory import cerebras, openrouter
from roboz.llm import LLMEndpoint, MockLLMEndpoint
from roboz.models import AgentMode
from roboz.shed.agents.orchestrator import ORCHESTRATOR_PROMPT
from roboz.shed.identifiers import COMPACTIFY_MESSAGES_TOOL_NAME
from roboz.shed.sandbox import Sandbox
from roboz.tools import stop

from robozium.api.projects import Project
from robozium.hub.skills import robozium as robozium_skill
from robozium.hub.utils import load_hub


def test_configured_models_apply_per_use_request_policy(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY_SECRET", "test-only")
    monkeypatch.setenv("CEREBRAS_API_KEY_SECRET", "test-only")
    hub = load_hub()
    endpoints = [endpoint for endpoint in hub.model_selector.models.values()]
    project = hub.project("policy-test")
    deployment = hub.configure_deployment(
        project.sandbox, project.slug, endpoint_getter=lambda: hub.default_model
    ).build()
    memory = deployment[1][0].agent_endpoint
    assert all(isinstance(endpoint, LLMEndpoint) for endpoint in endpoints)
    for endpoint in endpoints[:2]:
        assert endpoint.max_context_tokens == 1_310_720
        assert endpoint.extra_body == {
            "provider": {"sort": "throughput", "require_parameters": True},
            "reasoning": {"effort": "low"},
        }
    assert memory.extra_body["reasoning"] == {"effort": "high"}
    assert memory.client is endpoints[0].client
    assert endpoints[2].extra_body is None
    for endpoint in (*endpoints, memory):
        endpoint.client.close()


def _specialist(name, *, subagents=(), background_agents=(), responses=None):
    definition = DeployableAgent(
        name=name,
        system_prompt="Run specialists and stop.",
        capabilities=(Capability(label=ToolLabel("stop"), value=stop),),
        nested_agents=subagents,
        background_agents=background_agents,
    )
    definition.set_agent_endpoint(
        MockLLMEndpoint(
            responses or [{"action": "stop", "rationale": "test action", "value": name}]
        )
    )
    return definition


def test_composition_uses_persistent_preset_and_has_no_construction_side_effects(
    tmp_path, monkeypatch
):
    sandbox = Sandbox(
        tmp_path / "absent",
        readonly="references",
        shared="team",
        projects="work",
        logs=Path("conversations"),
        snapshots=Path("summaries"),
        memory=Path("preferences"),
        scope="demo",
    )
    project = Project(sandbox, "demo")
    root_endpoint = openrouter.z_ai__glm_5_3
    memory_endpoint = cerebras.gpt_oss_120b
    nested = _specialist(
        "nested", background_agents=(_specialist("specialist_maintenance"),)
    )
    spec = _specialist("specialist", subagents=(nested,))

    def reject(*args, **kwargs):
        raise AssertionError("construction started work")

    monkeypatch.setattr(Thread, "start", reject)
    for key in ("OPENROUTER_API_KEY_SECRET", "CEREBRAS_API_KEY_SECRET", "OPENAI_API_KEY_SECRET"):
        monkeypatch.delenv(key, raising=False)
    deployment = configured_deployment(
        project, root_endpoint, memory_endpoint=memory_endpoint, subagents=(spec,)
    )
    agent, (specialist_background, background) = deployment
    assert agent.system_prompt == ORCHESTRATOR_PROMPT
    assert "specialist" in {tool.name for tool in agent.tools}
    memory_path, context = agent.initial_messages
    assert memory_path == project.memory
    assert "<file src=" not in context
    assert str(project.sandbox.resolved_root) in context
    assert str(project.root) in context
    for location in (project.logs, project.snapshots, project.memory):
        assert str(location) in context
    assert agent.mode is AgentMode.STEERABLE
    assert specialist_background.name == "specialist_maintenance"
    assert robozium_skill in agent.auto_loaded_skills
    assert robozium_skill.name == "robozium"
    assert any(skill.name == "filesystem" for skill in agent.auto_loaded_skills)
    assert '<file src="relative/path.ext">' in robozium_skill.instructions
    assert "runtime-supplied" in robozium_skill.instructions
    assert not project.sandbox.root.exists()
    assert agent.initial_messages[0] == project.memory
    assert agent.pipe.data_path == project.logs / "orchestrator"
    assert background.pipe.data_path == project.logs / "librarian"
    assert background.mode is AgentMode.DETERMINISTIC
    assert [tool.name for tool in background.default_tools] == [
        "snapshot_conversations",
        "consolidate_memory",
        "purge_logs",
        "purge_snapshots",
        "purge_memory",
        "stop_when_watched_agents_inactive",
        "sleep_between_runs",
    ]
    compactifier = next(
        t for t in agent.default_tools if t.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    assert compactifier.external_dependencies() == (root_endpoint,)
    for tool in background.default_tools[:2]:
        assert tool.external_dependencies() == (memory_endpoint,)


def test_nested_specialists_have_separate_persistence_and_seed_memory(tmp_path):
    project = Project(Sandbox(tmp_path).for_project("demo"), "demo")
    project.memory.mkdir(parents=True)
    (project.memory / "remember.md").write_text("REMEMBER-PREFERENCES")
    nested = _specialist("nested")
    specialist = _specialist(
        "specialist",
        subagents=(nested,),
        responses=[
            {"action": "nested", "rationale": "test action"},
            {"action": "stop", "rationale": "test action", "value": "specialist"},
        ],
    )
    deployment = configured_deployment(
        project,
        MockLLMEndpoint(
            [
                {"action": "specialist", "rationale": "test action"},
                {"action": "stop", "rationale": "test action", "value": "done"},
            ]
        ),
        subagents=(specialist,),
    )
    agent = foreground_agent(deployment)
    result, _ = agent.invoke()
    assert result.value == "done"
    names = {"orchestrator", "specialist", "nested"}
    assert {p.name for p in project.logs.iterdir()} == names
    for name in names:
        (log,) = (project.logs / name).rglob("*.json")
        data = json.loads(log.read_text())
        assert data["agent_name"] == name and data["status"] == "completed"
        if name == "orchestrator":
            assert "REMEMBER-PREFERENCES" in log.read_text()
            assert str(project.root) in log.read_text()
            assert "## Project context" in log.read_text()


def test_route_discovery_and_compaction_follow_model_switch_without_rebuild(tmp_path):
    first, second = openrouter.z_ai__glm_5_3, openrouter.z_ai__glm_5_3_flash
    memory = cerebras.gpt_oss_120b
    selected = first
    project = Project(Sandbox(tmp_path).for_project("demo"), "demo")
    hub = load_hub()
    hub = replace(hub, memory_endpoint=memory)
    deployment = hub.configure_deployment(
        project.sandbox,
        project.slug,
        endpoint_getter=lambda: selected,
    ).build()
    agent, (background,) = deployment
    route = agent.agent_endpoint
    compactifier = next(
        t for t in agent.default_tools if t.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    assert agent.agent_endpoint is route
    assert compactifier.external_dependencies() == (first,)
    assert first in agent.external_dependencies()
    selected = second
    assert second in agent.external_dependencies()
    assert first not in agent.external_dependencies()
    assert route.external_dependencies() == (second,)
    assert compactifier.external_dependencies() == (second,)
    assert memory in background.external_dependencies()


def test_project_binding_cannot_disagree_with_the_sandbox():
    hub = load_hub()
    project = hub.project("one")
    with pytest.raises(ValueError, match="match the sandbox scope"):
        Project(project.sandbox, "two")
    with pytest.raises(ValueError, match="match the sandbox scope"):
        hub.configure_deployment(
            project.sandbox, "two", endpoint_getter=lambda: hub.default_model
        )


def test_project_alias_cannot_bind_another_projects_sandbox(tmp_path):
    hub = load_hub()
    hub = replace(hub, sandbox=replace(hub.sandbox, root=tmp_path))
    other = hub.project("other")
    other.root.mkdir(parents=True)
    (hub.sandbox.projects_dir / "alias").symlink_to(
        other.root, target_is_directory=True
    )

    with pytest.raises(ValueError, match="symbolic link"):
        hub.project("alias")
    assert hub.sandbox.scope is None


def test_interleaved_deployments_keep_project_paths_and_policies_separate(tmp_path):
    hub = load_hub()
    hub = replace(hub, sandbox=replace(hub.sandbox, root=tmp_path / "sandbox"))
    first, second = hub.project("one"), hub.project("two")
    events = [[], []]
    recipes = [
        configured_deployment(
            project,
            MockLLMEndpoint(
                [
                    {
                        "action": "apply_patch",
                        "rationale": "own project",
                        "path": f"projects/{project.slug}/note.txt",
                        "old_string": "",
                        "new_string": project.slug,
                    },
                    {
                        "action": "apply_patch",
                        "rationale": "other project",
                        "path": f"projects/{other.slug}/note.txt",
                        "old_string": "",
                        "new_string": "wrong",
                    },
                    {"action": "stop", "rationale": "done", "value": project.slug},
                ]
            ),
            event_sinks=(sink.append,),
        )
        for project, other, sink in (
            (first, second, events[0]),
            (second, first, events[1]),
        )
    ]
    assert recipes[0] is not recipes[1]
    assert first.sandbox is not second.sandbox
    assert first.sandbox is not hub.sandbox
    assert hub.sandbox.scope is None
    assert not hub.sandbox.root.exists()
    assert recipes[0][0].pipe is not recipes[1][0].pipe
    for project, (agent, (background,)) in zip((first, second), recipes, strict=True):
        assert agent.pipe.data_path == project.logs / "orchestrator"
        assert background.pipe.data_path == project.logs / "librarian"
        assert agent.initial_messages[0] == project.memory
        assert str(project.root) in agent.initial_messages[1]
        project.root.mkdir(parents=True)
    for index, recipe in enumerate(recipes):
        foreground_agent(recipe).invoke()
        assert events[index]
        if index == 0:
            assert not events[1]
            assert not (second.root / "note.txt").exists()
    assert (first.root / "note.txt").read_text() == "one"
    assert (second.root / "note.txt").read_text() == "two"
