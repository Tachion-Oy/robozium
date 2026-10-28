import pytest
from roboz.endpoints.adapters.openai_compatible import OpenAICompatibleAdapter
from roboz.endpoints.catalog import Catalog
from roboz.endpoints.specs import ChatModelSpec, TranscriptionModelSpec
from roboz.llm import LLMEndpoint
from roboz.models import Message

from robozium import model_check
from robozium.model_check import (
    ModelResult,
    check_catalog,
    format_result,
    mentions,
    metadata_problems,
)

_VISION = ChatModelSpec("lab/vision", 1_000, accepts_images=True)
_TEXT = ChatModelSpec("lab/text", 1_000)
_PUBLISHED = {
    "lab/vision": {
        "architecture": {"input_modalities": ["text", "image"]},
        "context_length": 1_000,
        "supported_parameters": ["tools", "max_tokens"],
    },
    "lab/text": {
        "architecture": {"input_modalities": ["text"]},
        "context_length": 2_000,
        "supported_parameters": ["tools"],
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
        models={
            "vision": _VISION,
            "text": _TEXT,
            "whisper": TranscriptionModelSpec("lab/whisper"),
        },
    )


class _Replies:
    def __init__(self, **replies: str) -> None:
        self.replies = replies
        self.sent: list[tuple[str, Message]] = []

    def __call__(self, endpoint: LLMEndpoint, message: Message) -> str:
        self.sent.append((endpoint.model_name, message))
        kind = "image" if message.images else "text"
        reply = self.replies[kind]
        if reply == "raise":
            raise RuntimeError("provider unavailable")
        return reply


def test_metadata_matches_published_capabilities() -> None:
    assert metadata_problems(_VISION, _PUBLISHED["lab/vision"]) == []
    assert metadata_problems(_TEXT, _PUBLISHED["lab/text"]) == []


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
    ],
)
def test_metadata_reports_each_mismatch(spec, published, problem) -> None:
    assert any(problem in found for found in metadata_problems(spec, published))


def test_metadata_tolerates_null_published_fields() -> None:
    published = {"architecture": None, "supported_parameters": None}

    assert metadata_problems(_TEXT, published) == ["provider does not list tool support"]


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


def test_chat_models_receive_text_and_only_vision_models_receive_images() -> None:
    ping = _Replies(text="Hello!", image="Red.")

    results = list(check_catalog(_catalog(), required=True, published=_PUBLISHED, ping=ping))

    assert results == [
        ModelResult("openrouter", _VISION, None, None, None),
        ModelResult("openrouter", _TEXT, None, None, None),
    ]
    assert sorted((model, bool(message.images)) for model, message in ping.sent) == [
        ("lab/text", False),
        ("lab/vision", False),
        ("lab/vision", True),
    ]


def test_probe_requests_are_bounded_and_use_the_openrouter_policy() -> None:
    seen: list[LLMEndpoint] = []

    def ping(endpoint: LLMEndpoint, message: Message) -> str:
        seen.append(endpoint)
        return "hello red"

    list(check_catalog(_catalog(), required=True, published=None, ping=ping))
    list(
        check_catalog(
            _catalog(api_name="cerebras"), required=True, published=None, ping=ping
        )
    )

    routed, local = seen[0].extra_body, seen[-1].extra_body
    assert routed is not None and local is not None
    assert routed["max_tokens"] == model_check.MAX_OUTPUT_TOKENS
    assert routed["reasoning"] == {"effort": "low"}
    assert local == {"max_tokens": model_check.MAX_OUTPUT_TOKENS}


def test_wrong_replies_errors_and_metadata_fail_without_stopping() -> None:
    ping = _Replies(text="raise", image="It is blue.")
    published = {"lab/vision": _PUBLISHED["lab/text"]}

    vision, text = check_catalog(_catalog(), required=True, published=published, ping=ping)

    assert vision.text == "RuntimeError: provider unavailable"
    assert vision.image == "unexpected reply 'It is blue.'"
    assert vision.metadata is not None and "accepts_images is True" in vision.metadata
    assert text.metadata == "not listed by the provider"
    assert not vision.passed and not text.passed


def test_missing_key_skips_unless_the_provider_is_required(monkeypatch) -> None:
    monkeypatch.delenv("MODEL_CHECK_TEST_KEY", raising=False)
    monkeypatch.setattr(
        "roboz.endpoints.adapters.openai_compatible.load_secrets", lambda: None
    )
    ping = _Replies(text="hello", image="red")

    optional = list(check_catalog(_catalog(None), required=False, published=None, ping=ping))
    required = list(check_catalog(_catalog(None), required=True, published=None, ping=ping))

    assert all(result.skipped and "MODEL_CHECK_TEST_KEY" in result.skipped for result in optional)
    assert all(result.text and not result.passed for result in required)
    assert ping.sent == []


def test_result_lines_show_each_check() -> None:
    passed = ModelResult("openrouter", _TEXT, None, None, None)
    failed = ModelResult("cerebras", _VISION, None, "unexpected reply 'blue'", None)
    skipped = ModelResult("groq", _TEXT, None, None, None, skipped="Set KEY")

    assert format_result(passed) == (
        "PASS openrouter lab/text | text ok | image - | metadata ok"
    )
    assert format_result(failed) == (
        "FAIL cerebras lab/vision | text ok"
        " | image FAIL (unexpected reply 'blue') | metadata -"
    )
    assert format_result(skipped) == "SKIP groq lab/text: Set KEY"


def test_main_fails_when_any_selected_model_fails(monkeypatch, capsys) -> None:
    monkeypatch.setattr(model_check, "_catalogs", lambda: {"openrouter": _catalog()})
    monkeypatch.setattr(model_check, "fetch_openrouter_models", lambda: _PUBLISHED)
    monkeypatch.setattr(model_check, "_live_ping", _Replies(text="hello", image="blue"))

    assert model_check.main(["--provider", "openrouter"]) == 1
    lines = capsys.readouterr().out.splitlines()
    assert lines[0].startswith("FAIL openrouter lab/vision")
    assert lines[1].startswith("PASS openrouter lab/text")


def test_main_fails_when_no_model_was_checked(monkeypatch, capsys) -> None:
    monkeypatch.delenv("MODEL_CHECK_TEST_KEY", raising=False)
    monkeypatch.setattr(
        "roboz.endpoints.adapters.openai_compatible.load_secrets", lambda: None
    )
    monkeypatch.setattr(model_check, "_catalogs", lambda: {"cerebras": _catalog(None)})

    assert model_check.main([]) == 1
    assert capsys.readouterr().out.splitlines()[-1] == "FAIL no chat model was checked"


def test_main_fails_clearly_when_the_listing_is_unavailable(monkeypatch, capsys) -> None:
    def unavailable():
        raise OSError("network down")

    monkeypatch.setattr(model_check, "_catalogs", lambda: {"openrouter": _catalog()})
    monkeypatch.setattr(model_check, "fetch_openrouter_models", unavailable)

    assert model_check.main([]) == 1
    assert capsys.readouterr().out == (
        "FAIL openrouter model listing: OSError: network down\n"
    )
