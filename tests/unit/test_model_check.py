import pytest
from roboz.agent import Agent
from roboz.endpoints.adapters.openai_compatible import OpenAICompatibleAdapter
from roboz.endpoints.catalog import Catalog
from roboz.endpoints.specs import ChatModelSpec
from roboz.llm import LLMEndpoint, MockLLMEndpoint, with_openrouter_policy
from roboz.models import Message, Role
from roboz.tools import stop

from scripts import model_check
from scripts.model_check import (
    ModelResult,
    format_result,
    mentions,
    metadata_problems,
    run_checks,
)

_VISION = ChatModelSpec("lab/vision", 1_000, accepts_images=True)
_TEXT = ChatModelSpec("lab/text", 1_000)
_PUBLISHED = {
    "lab/vision": {
        "architecture": {"input_modalities": ["text", "image"]},
        "context_length": 1_000,
        "supported_parameters": ["tools", "max_tokens", "temperature"],
    },
    "lab/text": {
        "architecture": {"input_modalities": ["text"]},
        "context_length": 2_000,
        "supported_parameters": ["tools", "temperature"],
    },
}


def _catalog(api_key: str | None = "test-only", api_name: str = "openrouter"):
    return Catalog(
        adapter=OpenAICompatibleAdapter(
            api_name=api_name,
            base_url="https://models.invalid/v1",
            api_key_env="MODEL_CHECK_TEST_KEY",
            api_key=api_key,
        ),
        models={"vision": _VISION, "text": _TEXT},
    )


def _models(catalog=None) -> dict[str, LLMEndpoint]:
    catalog = catalog or _catalog()
    return {
        "Vision · Fast": with_openrouter_policy(catalog.vision, reasoning_effort="low"),
        "Text · Deep reasoning": with_openrouter_policy(
            catalog.text, reasoning_effort="high"
        ),
    }


_TOOL_CALL = '{"action": "stop", "rationale": "greeted", "value": "Hi"}'


def _agent(endpoint: LLMEndpoint) -> Agent:
    return Agent(
        name="probe",
        tools=[stop],
        system_prompt=f"Orchestrate on {endpoint.model_name}.",
        agent_endpoint=MockLLMEndpoint([]),
    )


class _Replies:
    """Answer each probe kind with one reply, or with a list consumed in order."""

    def __init__(self, **replies: str | list[str]) -> None:
        self.replies = replies
        self.sent: list[tuple[str, Message, dict]] = []
        self.conversations: list[list[Message]] = []

    def __call__(self, endpoint: LLMEndpoint, messages: list[Message]) -> str:
        self.conversations.append(messages)
        message = messages[-1]
        self.sent.append((endpoint.model_name, message, dict(endpoint.extra_body or {})))
        reply = self.replies["image" if message.images else "text"]
        if isinstance(reply, list):
            reply = reply.pop(0) if len(reply) > 1 else reply[0]
        if reply == "raise":
            raise RuntimeError("provider unavailable")
        return reply


def _without_key(monkeypatch) -> None:
    monkeypatch.delenv("MODEL_CHECK_TEST_KEY", raising=False)
    monkeypatch.setattr(
        "roboz.endpoints.adapters.openai_compatible.load_secrets", lambda: None
    )


def test_metadata_matches_published_capabilities() -> None:
    assert metadata_problems(_VISION, _PUBLISHED["lab/vision"]) == []
    assert metadata_problems(_TEXT, _PUBLISHED["lab/text"]) == []
    reasoning = ChatModelSpec("lab/text", 1_000, accepts_temperature=False)
    assert metadata_problems(reasoning, {**_PUBLISHED["lab/text"], "supported_parameters": ["tools"]}) == []


@pytest.mark.parametrize(
    ("spec", "published", "problem"),
    [
        (_TEXT, None, "not listed by the provider"),
        (_TEXT, _PUBLISHED["lab/vision"], "accepts_images is False"),
        (_VISION, _PUBLISHED["lab/text"], "accepts_images is True"),
        (
            ChatModelSpec("lab/vision", 5_000, accepts_images=True),
            _PUBLISHED["lab/vision"],
            "max_context_tokens 5000 exceeds provider 1000",
        ),
        (
            _TEXT,
            {**_PUBLISHED["lab/text"], "supported_parameters": ["max_tokens"]},
            "provider does not list tool support",
        ),
        (
            _TEXT,
            {"architecture": None, "supported_parameters": None},
            "provider does not list tool support",
        ),
        (
            _TEXT,
            {**_PUBLISHED["lab/text"], "supported_parameters": ["tools"]},
            "accepts_temperature is True, provider omits temperature",
        ),
        (
            ChatModelSpec("lab/text", 1_000, accepts_temperature=False),
            _PUBLISHED["lab/text"],
            "accepts_temperature is False, provider lists temperature",
        ),
    ],
)
def test_metadata_reports_each_mismatch(spec, published, problem) -> None:
    assert any(problem in found for found in metadata_problems(spec, published))


@pytest.mark.parametrize(
    ("reply", "word", "expected"),
    [
        ("Red.", "red", True),
        ("HELLO", "hello", True),
        ("the colored area", "red", False),
        ("othello", "hello", False),
    ],
)
def test_replies_must_contain_the_whole_word(reply, word, expected) -> None:
    assert mentions(reply, word) is expected


def test_models_are_probed_with_their_configured_effort_and_a_limit() -> None:
    ping = _Replies(text="Hello!", image="Red.")

    results = run_checks(_models(), required=True, published=_PUBLISHED, ping=ping)

    assert [(result.label, result.passed) for result in results] == [
        ("Vision · Fast", True),
        ("Text · Deep reasoning", True),
    ]
    sent = sorted(
        (model, bool(message.images), body["reasoning"]["effort"], body["max_tokens"])
        for model, message, body in ping.sent
    )
    limit = model_check.MAX_OUTPUT_TOKENS
    assert sent == [
        ("lab/text", False, "high", limit),
        ("lab/vision", False, "low", limit),
        ("lab/vision", True, "low", limit),
    ]
    assert all(body["provider"]["require_parameters"] for _, _, body in ping.sent)


def test_wrong_replies_errors_and_metadata_fail_without_stopping() -> None:
    ping = _Replies(text="raise", image="It is blue.")
    published = {"lab/vision": _PUBLISHED["lab/text"]}

    vision, text = run_checks(_models(), required=True, published=published, ping=ping)

    assert vision.text == "RuntimeError: provider unavailable"
    assert vision.image == "unexpected reply 'It is blue.'"
    assert vision.metadata is not None and "accepts_images is True" in vision.metadata
    assert text.metadata == "not listed by the provider"
    assert not vision.passed and not text.passed
    attempts = model_check.PROBE_ATTEMPTS
    probes = sorted(bool(m.images) for model, m, _ in ping.sent if model == "lab/vision")
    assert probes == [False] * attempts + [True] * attempts


@pytest.mark.parametrize("first", ["raise", "", "Goodbye."])
def test_a_probe_passes_when_a_retry_succeeds(first) -> None:
    ping = _Replies(text=[first, "Hello!"], image="Red.")

    (result,) = run_checks(
        {"Text": _models()["Text · Deep reasoning"]},
        required=True,
        published=None,
        ping=ping,
    )

    assert result.passed
    assert len(ping.sent) == 2


def test_missing_key_skips_unless_the_provider_is_required(monkeypatch) -> None:
    _without_key(monkeypatch)
    ping = _Replies(text="hello", image="red")
    models = _models(_catalog(None))

    optional = run_checks(models, required=False, published=None, ping=ping)
    required = run_checks(models, required=True, published=None, ping=ping)

    assert all(r.skipped and "MODEL_CHECK_TEST_KEY" in str(r.unavailable) for r in optional)
    assert all(not r.skipped and not r.passed and r.text is None for r in required)
    assert format_result(required[0]).startswith(
        "FAIL openrouter lab/vision [Vision · Fast]: Set MODEL_CHECK_TEST_KEY"
    )
    assert ping.sent == []


def test_an_unexpected_setup_error_fails_only_that_model(monkeypatch) -> None:
    def broken(*_args, **_kwargs):
        raise RuntimeError("bad settings")

    monkeypatch.setattr(model_check, "check_model", broken)

    results = run_checks(_models(), required=False, published=None, ping=_Replies())

    assert [result.unavailable for result in results] == ["RuntimeError: bad settings"] * 2
    assert not any(result.skipped or result.passed for result in results)


def test_result_lines_show_each_check() -> None:
    models = _models()
    vision, text = models["Vision · Fast"], models["Text · Deep reasoning"]
    local = _catalog(api_name="cerebras").text

    assert format_result(ModelResult("Text · Deep reasoning", text)) == (
        "PASS openrouter lab/text [Text · Deep reasoning]"
        " | text ok | image - | metadata ok"
    )
    assert format_result(ModelResult("Local", local, text="unexpected reply ''")) == (
        "FAIL cerebras lab/text [Local] | text FAIL (unexpected reply '')"
        " | image - | metadata -"
    )
    assert format_result(
        ModelResult("Vision · Fast", vision, unavailable="Set KEY", required=False)
    ) == "SKIP openrouter lab/vision [Vision · Fast]: Set KEY"


def test_chat_models_get_the_agent_system_prompt_and_must_call_a_tool() -> None:
    models = {**_models(), model_check.MEMORY_LABEL: _models()["Text · Deep reasoning"]}
    ping = _Replies(text=_TOOL_CALL, image="red")
    built: dict[str, Agent] = {}

    def build_agent(endpoint: LLMEndpoint) -> Agent:
        built[endpoint.model_name] = _agent(endpoint)
        return built[endpoint.model_name]

    vision, text, memory = run_checks(
        models, required=True, published=None, ping=ping, build_agent=build_agent
    )

    assert vision.passed and text.passed
    assert memory.text == f"unexpected reply {_TOOL_CALL!r}"
    assert sorted(built) == ["lab/text", "lab/vision"]
    agent_conversations = sorted(
        tuple(message.content for message in conversation)
        for conversation in ping.conversations
        if conversation[0].role == Role.SYSTEM
    )
    assert agent_conversations == sorted(
        (agent.full_system_prompt, model_check.AGENT_GREETING)
        for agent in built.values()
    )

@pytest.mark.parametrize(
    "reply", ["", "hello", '{"rationale": "no action"}', '{"action": "missing", "rationale": "x"}']
)
def test_agent_probe_fails_without_a_valid_tool_call(reply) -> None:
    (result,) = run_checks(
        {"Text": _models()["Text · Deep reasoning"]},
        required=True,
        published=None,
        ping=_Replies(text=reply),
        build_agent=_agent,
    )

    assert result.text == f"unexpected reply {reply!r}"


def test_main_checks_the_memory_model_and_fails_on_any_failure(monkeypatch, capsys) -> None:
    models = {**_models(), model_check.MEMORY_LABEL: _models()["Text · Deep reasoning"]}
    monkeypatch.setattr(model_check, "configured_models", lambda: models)
    monkeypatch.setattr(model_check, "fetch_openrouter_models", lambda: _PUBLISHED)
    monkeypatch.setattr(model_check, "build_orchestrator", _agent)
    monkeypatch.setattr(
        model_check,
        "_live_ping",
        lambda endpoint, messages: (
            "blue" if messages[-1].images
            else _TOOL_CALL if messages[0].role == Role.SYSTEM
            else "hello"
        ),
    )

    assert model_check.main(["--provider", "openrouter"]) == 1
    lines = capsys.readouterr().out.splitlines()
    assert [line.split(" | ")[0] for line in lines] == [
        "FAIL openrouter lab/vision [Vision · Fast]",
        "PASS openrouter lab/text [Text · Deep reasoning]",
        "PASS openrouter lab/text [Memory]",
    ]


def test_main_fails_when_no_model_was_checked(monkeypatch, capsys) -> None:
    _without_key(monkeypatch)
    monkeypatch.setattr(model_check, "configured_models", lambda: _models(_catalog(None)))
    monkeypatch.setattr(model_check, "fetch_openrouter_models", lambda: _PUBLISHED)

    assert model_check.main([]) == 1
    assert capsys.readouterr().out.splitlines()[-1] == "FAIL no chat model was checked"


def test_main_fails_clearly_when_the_listing_is_unavailable(monkeypatch, capsys) -> None:
    def unavailable():
        raise OSError("network down")

    monkeypatch.setattr(model_check, "configured_models", _models)
    monkeypatch.setattr(model_check, "fetch_openrouter_models", unavailable)

    assert model_check.main([]) == 1
    assert capsys.readouterr().out == (
        "FAIL openrouter model listing: OSError: network down\n"
    )


def test_the_orchestrator_prompt_comes_from_the_application_deployment() -> None:
    from roboz.shed.agents.orchestrator import ORCHESTRATOR_PROMPT

    agent = model_check.build_orchestrator(_models()["Text · Deep reasoning"])

    assert agent.full_system_prompt.startswith(ORCHESTRATOR_PROMPT)
    assert "# Instructions on Tool Usage" in agent.full_system_prompt
