"""Application composition on shared definitions, without live credentials."""

import json
from dataclasses import replace
from pathlib import Path
from threading import Thread

import pytest
from deployment_support import configured_deployment
from roboshed.agents.orchestrator import ORCHESTRATOR_PROMPT
from roboshed.capabilities import Compactification, MaintenanceCadence
from roboshed.deployments import Deployment
from roboshed.identifiers import COMPACTIFY_MESSAGES_TOOL_NAME
from roboshed.sandbox import Sandbox
from roboshed.skills import robosprawl as robosprawl_skill
from roboz.deployment import Capability, DeployableAgent
from roboz.llm import LLMEndpoint, MockLLMEndpoint
from roboz.runtime import Output
from roboz.tools import stop
from roboz_endpoints import cerebras, openrouter

from robosprawl.api.projects import Project
from robosprawl.hub.utils import load_hub


def test_configured_models_apply_per_use_request_policy(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only")
    monkeypatch.setenv("CEREBRAS_API_KEY", "test-only")
    hub = load_hub()
    endpoints = [
        endpoint.materialize() for endpoint in hub.model_selector.models.values()
    ]
    project = hub.project("policy-test")
    deployment = hub.configure_deployment(
        project.sandbox, project.slug, endpoint_getter=lambda: hub.default_model
    )
    memory = deployment.agent.background_agents[0].agent_endpoint.materialize()
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
    return DeployableAgent(
        name=name,
        interaction_mode=Output.API,
        system_prompt="Run specialists and stop.",
        agent_endpoint=MockLLMEndpoint(
            responses or [{"action": "stop", "rationale": "test action", "value": name}]
        ),
        capabilities=(Capability(tools=(stop,)),),
        subagents=subagents,
        background_agents=background_agents,
    )


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
    for key in ("OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    deployment = configured_deployment(
        project, root_endpoint, memory_endpoint=memory_endpoint, subagents=(spec,)
    )
    assert isinstance(deployment, Deployment)
    names = deployment.agent.agent_names(include_background=False)
    assert names == {"orchestrator", "specialist", "nested"}
    assert deployment.agent.system_prompt == ORCHESTRATOR_PROMPT
    memory_path, context = deployment.agent.initial_messages
    assert memory_path == project.memory
    assert "<file src=" not in context
    assert str(project.sandbox.resolved_root) in context
    assert str(project.root) in context
    for location in (project.logs, project.snapshots, project.memory):
        assert str(location) in context
    assert deployment.agent.interaction_mode == Output.API
    compaction = next(
        c for c in deployment.additional_capabilities if isinstance(c, Compactification)
    )
    assert compaction.threshold_percent == 60 and compaction.timeout_s is None
    (librarian,) = deployment.agent.background_agents
    snapshots, consolidation, retention, cadence = librarian.capabilities
    assert (
        snapshots.agent_names
        == consolidation.agent_names
        == cadence.agent_names
        == names
    )
    assert snapshots.token_growth_threshold == 20_000
    assert consolidation.min_pending_snapshots == 3
    assert consolidation.max_pending_age_seconds == 86_400
    assert (
        retention.max_log_files,
        retention.max_snapshot_files,
        retention.max_memory_files,
    ) == (500, 100, 10)
    assert isinstance(cadence, MaintenanceCadence) and cadence.seconds == 120
    agent, (specialist_background, background) = deployment.build()
    assert specialist_background.name == "specialist_maintenance"
    assert robosprawl_skill in agent.auto_loaded_skills
    assert '<file src="relative/path.ext">' in robosprawl_skill.instructions
    assert "runtime-supplied" in robosprawl_skill.instructions
    assert not project.sandbox.root.exists()
    assert agent.initial_messages == deployment.agent.initial_messages
    assert agent.initial_messages[0] == project.memory
    assert agent.pipe.data_path == project.logs / "orchestrator"
    assert background.pipe.data_path == project.logs / "librarian"
    assert not background.is_agentic
    assert [tool.name for tool in background.default_tools] == [
        "snapshot_conversations",
        "consolidate_memory",
        "purge_logs",
        "purge_snapshots",
        "purge_memory",
        "sleep_between_runs",
    ]
    compactifier = next(
        t for t in agent.default_tools if t.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    assert compactifier.dependencies[0] is root_endpoint
    for tool in background.default_tools[:2]:
        assert tool.dependencies[0] is memory_endpoint


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
    deployment.agent = replace(deployment.agent, background_agents=())
    agent, _ = deployment.build()
    result, _ = agent.invoke()
    assert result.value == "done"
    assert {p.name for p in project.logs.iterdir()} == deployment.agent.agent_names()
    for name in deployment.agent.agent_names():
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
    hub = replace(hub, deployment=replace(hub.deployment, memory_endpoint=memory))
    deployment = hub.configure_deployment(
        project.sandbox,
        project.slug,
        endpoint_getter=lambda: selected,
    )
    route = deployment.agent.agent_endpoint
    agent, (background,) = deployment.build()
    compactifier = next(
        t for t in agent.default_tools if t.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    assert agent.agent_endpoint is route
    assert compactifier.external_dependencies == (first,)
    assert first in agent.external_dependencies()
    selected = second
    assert second in agent.external_dependencies()
    assert first not in agent.external_dependencies()
    assert route.external_dependencies() == (second,)
    assert compactifier.external_dependencies == (second,)
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
    from roboshed.models import ActionVerdict, Operation
    from roboshed.tools.utils import check_allow_deny_permission

    hub = load_hub()
    hub = replace(hub, sandbox=replace(hub.sandbox, root=tmp_path / "sandbox"))
    first, second = hub.project("one"), hub.project("two")
    deployments = [
        hub.configure_deployment(
            p.sandbox, p.slug, endpoint_getter=lambda: hub.default_model
        )
        for p in (first, second)
    ]
    assert first.sandbox is not second.sandbox
    assert first.sandbox is not hub.sandbox
    assert hub.sandbox.scope is None
    for project, deployment in zip((first, second), deployments, strict=True):
        agent, (background,) = deployment.build()
        assert deployment.sandbox is not project.sandbox
        assert deployment.sandbox == project.sandbox
        assert agent.pipe.data_path == project.logs / "orchestrator"
        assert background.pipe.data_path == project.logs / "librarian"
        assert agent.initial_messages == deployment.agent.initial_messages
        assert agent.initial_messages[0] == project.memory
        assert str(project.root) in agent.initial_messages[1]
        for capability in deployment.agent.background_agents[0].capabilities:
            assert capability.sandbox is deployment.sandbox
        for capability in deployment.agent.capabilities[1:]:
            policy = capability.permissions
            for target in (first, second):
                verdict = check_allow_deny_permission(
                    location=target.root / "note.txt",
                    op_type=Operation.CREATE,
                    takes_precedence=policy.takes_precedence,
                    allow_rules=policy.allow,
                    deny_rules=policy.deny,
                    default_verdict=policy.default_verdict,
                    base_path=policy.base,
                )
                expected = (
                    ActionVerdict.allow if target is project else ActionVerdict.deny
                )
                assert verdict == expected
    assert not hub.sandbox.root.exists()
