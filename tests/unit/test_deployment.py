"""Deployment composition and credential-free live configuration checks."""
from roboz import ExternalDependencyKind, LazyExternalDependency
from roboz.llm import LLMEndpoint

from robosprawl.composition import SubAgentSpec
from robosprawl.deployment import (
    DEFAULT_MEMORY_MODEL,
    ORCHESTRATOR_MODELS,
    standard_factory,
)
from robosprawl.mock.agents import HelloWorldConstructor


def test_standard_model_compositions_apply_per_use_request_policy(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only")
    monkeypatch.setenv("CEREBRAS_API_KEY", "test-only")
    endpoints = [endpoint.materialize() for endpoint in ORCHESTRATOR_MODELS.values()]
    memory = DEFAULT_MEMORY_MODEL.materialize()
    assert all(isinstance(endpoint, LLMEndpoint) for endpoint in endpoints)
    for endpoint in endpoints[:2]:
        assert endpoint.max_context_tokens == 1_310_720
        assert endpoint.extra_body == {"provider": {"sort": "throughput", "require_parameters": True}, "reasoning": {"effort": "low"}}
    assert memory.extra_body["reasoning"] == {"effort": "high"}
    assert endpoints[2].extra_body is None
    for endpoint in (*endpoints, memory):
        endpoint.client.close()


def test_standard_factory_defaults_to_the_hub_lineup():
    factory = standard_factory()
    assert factory.orchestrator.agent_name == "orchestrator"
    assert factory.librarian.agent_name == "librarian"
    assert factory.librarian.tuning.sleep_seconds == 120
    assert factory.orchestrator.subagents == ()


def test_standard_factory_endpoint_is_inspectable_without_loading_credentials():
    endpoint = standard_factory().orchestrator.endpoint()
    assert isinstance(endpoint, LazyExternalDependency)
    assert endpoint.kind is ExternalDependencyKind.MODEL_ENDPOINT
    assert endpoint.dependency_id == "model:openrouter:z-ai/glm-5.3"


def test_standard_factory_subagents_are_injectable():
    spec = SubAgentSpec(HelloWorldConstructor(), "hello_world", "Say hello")
    factory = standard_factory(subagents=[spec])
    assert factory.orchestrator.subagents == (spec,)
    assert factory.agent_names() == {"orchestrator", "hello_world"}


def test_live_configuration_reports_missing_credentials_in_fresh_process():
    import os
    import subprocess
    import sys
    env = {key: value for key, value in os.environ.items() if key not in {"OPENROUTER_API_KEY", "CEREBRAS_API_KEY", "OPENAI_API_KEY"}}
    subprocess.run([sys.executable, "-c", """
from robosprawl.deployment import ORCHESTRATOR_MODELS
from robosprawl.dependency_health import check_openai_compatible_endpoint, DependencyReasonCode
for endpoint in ORCHESTRATOR_MODELS.values():
    result = check_openai_compatible_endpoint(endpoint)
    assert result.reason_code == DependencyReasonCode.MISSING_CREDENTIALS, result
"""], env=env, check=True)
