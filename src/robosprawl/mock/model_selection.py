"""Scripted provider boundary for exercising real per-run endpoint routing."""

import json
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal, overload

from roboz.llm import LLMEndpoint, LLMEndpointRoute, with_request_options
from roboz.llm.openai_compatible import (
    OpenAIChatCompletion,
    OpenAIResponseFormat,
    OpenAIStreamOptions,
)

MODEL_REQUESTS_FILE = ".mock-model-requests.jsonl"


@dataclass(frozen=True)
class _ScriptedMessage:
    content: str


@dataclass(frozen=True)
class _ScriptedChoice:
    message: _ScriptedMessage


@dataclass(frozen=True)
class _ScriptedCompletion:
    choices: Sequence[_ScriptedChoice]
    usage: None = None


class _ScriptedModels:
    def __init__(self, model_name: str) -> None:
        self._model_name = model_name

    def list(self, *, timeout: float) -> object:
        del timeout
        return SimpleNamespace(data=[SimpleNamespace(id=self._model_name)])


class _ScriptedCompletions:
    def __init__(
        self, create_response: Callable[[str, object], OpenAIChatCompletion]
    ) -> None:
        self._create_response = create_response

    @overload
    def create(
        self,
        *,
        messages: Iterable[Any],
        model: str,
        temperature: float,
        response_format: OpenAIResponseFormat,
        extra_body: object = None,
        stream: Literal[False] = False,
    ) -> OpenAIChatCompletion: ...

    @overload
    def create(
        self,
        *,
        messages: Iterable[Any],
        model: str,
        temperature: float,
        response_format: OpenAIResponseFormat,
        extra_body: object = None,
        stream: Literal[True],
        stream_options: OpenAIStreamOptions = ...,
    ) -> Iterable[object]: ...

    def create(
        self,
        *,
        messages: Iterable[Any],
        model: str,
        temperature: float,
        response_format: OpenAIResponseFormat,
        extra_body: object = None,
        stream: bool = False,
        stream_options: OpenAIStreamOptions | None = None,
    ) -> OpenAIChatCompletion | Iterable[object]:
        del messages, temperature, response_format, stream_options
        if stream:
            raise ValueError("the scripted model-selection client does not stream")
        return self._create_response(model, extra_body)


@dataclass(frozen=True)
class _ScriptedChat:
    completions: _ScriptedCompletions


class _ScriptedClient:
    def __init__(
        self,
        model_name: str,
        create_response: Callable[[str, object], OpenAIChatCompletion],
    ) -> None:
        self.models = _ScriptedModels(model_name)
        self.chat = _ScriptedChat(_ScriptedCompletions(create_response))

    def close(self) -> None:
        pass


def model_selection_endpoint(
    endpoint: LLMEndpointRoute[LLMEndpoint], project_root: Path
) -> LLMEndpointRoute[LLMEndpoint]:
    """Use cached scripted clients selected by the shared live endpoint route.

    Each factory call owns its response sequence and clients. The journal records
    actual provider requests so browser tests can verify which model was called.
    """
    models: dict[str, LLMEndpoint] = {}
    request_count = 0

    def selected() -> LLMEndpoint:
        (dependency,) = endpoint.external_dependencies()
        if dependency.dependency_id not in models:
            metadata = dependency.redacted_metadata()

            def construct() -> LLMEndpoint:
                def create_response(
                    model: str, extra_body: object
                ) -> _ScriptedCompletion:
                    nonlocal request_count
                    request_count += 1
                    with (project_root / MODEL_REQUESTS_FILE).open(
                        "a", encoding="utf-8"
                    ) as journal:
                        journal.write(
                            json.dumps(
                                {
                                    "model_id": f"model:{metadata['api_name']}:{model}",
                                    "request": request_count,
                                    "extra_body": extra_body,
                                }
                            )
                            + "\n"
                        )
                    response = {
                        "action": "prompt_user",
                        "rationale": "wait for the next model selection",
                        "value": f"Model request {request_count} completed. Reply to continue.",
                    }
                    return _ScriptedCompletion(
                        choices=[
                            _ScriptedChoice(
                                message=_ScriptedMessage(content=json.dumps(response))
                            )
                        ],
                    )

                return LLMEndpoint(
                    client=_ScriptedClient(metadata["model_name"], create_response),
                    api_name=metadata["api_name"],
                    model_name=metadata["model_name"],
                    stream=False,
                )

            models[dependency.dependency_id] = construct()
        return models[dependency.dependency_id]

    return with_request_options(
        LLMEndpointRoute(selected), extra_body={"reasoning": {"effort": "low"}}
    )
