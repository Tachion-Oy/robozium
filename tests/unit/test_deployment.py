"""Application composition on shared definitions, without live credentials."""

import json
from dataclasses import replace
from pathlib import Path
from threading import Thread

from roboshed.agents.orchestrator import ORCHESTRATOR_PROMPT
from roboshed.capabilities import Compactification, MaintenanceCadence
from roboshed.deployments.robosprawl import AgenticFactory
from roboshed.identifiers import COMPACTIFY_MESSAGES_TOOL_NAME
from roboshed.skills import robosprawl as robosprawl_skill
from roboshed.workspace import Project, Workspace
from roboz import DependencyRoute
from roboz.deployment import AgentDefinition, Capability, SubAgentSpec
from roboz.llm import LLMEndpoint, MockLLMEndpoint
from roboz.runtime import Output
from roboz.tools import stop
from roboz_endpoints import cerebras, openrouter

from robosprawl.hub.utils import load_hub


def test_configured_models_apply_per_use_request_policy(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only")
    monkeypatch.setenv("CEREBRAS_API_KEY", "test-only")
    hub = load_hub()
    endpoints = [
        endpoint.materialize() for endpoint in hub.model_selector.models.values()
    ]
    memory = hub.deployment.recipe.memory_endpoint.materialize()
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


def _specialist(name, *, subagents=(), responses=None):
    return AgentDefinition(
        name=name,
        interaction_mode=Output.API,
        system_prompt="Run specialists and stop.",
        agent_endpoint=MockLLMEndpoint(
            responses or [{"action": "stop", "rationale": "test action", "value": name}]
        ),
        capabilities=(Capability(tools=(stop,)),),
        subagents=subagents,
    )


def test_composition_uses_persistent_preset_and_has_no_construction_side_effects(
    tmp_path, monkeypatch
):
    project = Project(
        Workspace(
            tmp_path / "absent", readonly="references", shared="team", projects="work"
        ),
        "demo",
        logs_dir=Path("conversations"),
        snapshots_dir=Path("summaries"),
        memory_dir=Path("preferences"),
    )
    root_endpoint = openrouter.z_ai__glm_5_3
    memory_endpoint = cerebras.gpt_oss_120b
    nested = SubAgentSpec(_specialist("nested"), "nested", "Nested specialist")
    spec = SubAgentSpec(
        _specialist("specialist", subagents=(nested,)), "delegate", "Delegate"
    )

    def reject(*args, **kwargs):
        raise AssertionError("construction started work")

    monkeypatch.setattr(Thread, "start", reject)
    for key in ("OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "OPENAI_API_KEY"):
        monkeypatch.delenv(key, raising=False)
    factory = replace(
        load_hub().deployment.recipe, memory_endpoint=memory_endpoint, subagents=(spec,)
    )(project, orchestrator_endpoint=root_endpoint)
    assert isinstance(factory, AgenticFactory)
    assert factory.agent_names() == {"orchestrator", "specialist", "nested"}
    assert factory.orchestrator.system_prompt.startswith(ORCHESTRATOR_PROMPT)
    assert "<file src=" not in factory.orchestrator.system_prompt
    assert str(project.workspace.resolved_root) in factory.orchestrator.system_prompt
    assert str(project.root) in factory.orchestrator.system_prompt
    for location in (project.logs, project.snapshots, project.memory):
        assert str(location) in factory.orchestrator.system_prompt
    assert factory.orchestrator.interaction_mode == Output.API
    compaction = next(
        c for c in factory.orchestrator.capabilities if isinstance(c, Compactification)
    )
    assert compaction.threshold_percent == 60 and compaction.timeout_s is None
    snapshots, consolidation, retention, cadence = factory.librarian.capabilities
    assert (
        snapshots.agent_names
        == consolidation.agent_names
        == cadence.agent_names
        == factory.agent_names()
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
    bundle = factory.build()
    assert robosprawl_skill in bundle.agent.auto_loaded_skills
    assert '<file src="relative/path.ext">' in robosprawl_skill.instructions
    assert "runtime-supplied" in robosprawl_skill.instructions
    assert not project.workspace.root.exists()
    assert bundle.agent.initial_messages == (project.memory,)
    assert bundle.agent.pipe.data_path == project.logs / "orchestrator"
    (background,) = bundle.background_agents
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
        t for t in bundle.agent.default_tools if t.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    assert compactifier.dependencies[0] is root_endpoint
    for tool in background.default_tools[:2]:
        assert tool.dependencies[0] is memory_endpoint


def test_nested_specialists_have_separate_persistence_and_seed_memory(tmp_path):
    project = Project(Workspace(tmp_path), "demo")
    project.memory.mkdir(parents=True)
    (project.memory / "remember.md").write_text("REMEMBER-PREFERENCES")
    nested = SubAgentSpec(_specialist("nested"), "nested", "Nested")
    specialist = SubAgentSpec(
        _specialist(
            "specialist",
            subagents=(nested,),
            responses=[
                {"action": "nested", "rationale": "test action"},
                {"action": "stop", "rationale": "test action", "value": "specialist"},
            ],
        ),
        "delegate",
        "Delegate",
    )
    factory = replace(
        load_hub().deployment.recipe,
        memory_endpoint=MockLLMEndpoint([]),
        subagents=(specialist,),
    )(
        project,
        orchestrator_endpoint=MockLLMEndpoint(
            [
                {"action": "delegate", "rationale": "test action"},
                {"action": "stop", "rationale": "test action", "value": "done"},
            ]
        ),
    )
    result, _ = replace(factory, librarian=None).build().agent.invoke()
    assert result.value == "done"
    assert {p.name for p in project.logs.iterdir()} == factory.agent_names()
    for name in factory.agent_names():
        (log,) = (project.logs / name).rglob("*.json")
        data = json.loads(log.read_text())
        assert data["agent_name"] == name and data["status"] == "completed"
        if name == "orchestrator":
            assert "REMEMBER-PREFERENCES" in log.read_text()


def test_route_discovery_and_compaction_follow_model_switch_without_rebuild(tmp_path):
    first, second = openrouter.z_ai__glm_5_3, openrouter.z_ai__glm_5_3_flash
    memory = cerebras.gpt_oss_120b
    selected = first
    route = DependencyRoute(lambda: selected)
    bundle = replace(load_hub().deployment.recipe, memory_endpoint=memory)(
        Project(Workspace(tmp_path), "demo"), orchestrator_endpoint=route
    ).build()
    compactifier = next(
        t for t in bundle.agent.default_tools if t.name == COMPACTIFY_MESSAGES_TOOL_NAME
    )
    assert bundle.agent.agent_endpoint is route
    assert compactifier.external_dependencies == (first,)
    assert first in bundle.agent.external_dependencies()
    selected = second
    assert second in bundle.agent.external_dependencies()
    assert first not in bundle.agent.external_dependencies()
    assert route.external_dependencies() == (second,)
    assert compactifier.external_dependencies == (second,)
    assert memory in bundle.background_agents[0].external_dependencies()
