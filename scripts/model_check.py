"""Ping every configured chat model and compare it with published model data.

Run ``uv run python scripts/model_check.py``. Each model the application can
select receives the orchestrator's real system prompt and a short greeting,
and must answer with a valid tool call. The memory model receives one short
text prompt. Models that accept images also receive one tiny image. Requests
carry the application's own request options, including reasoning effort, plus
an output limit. OpenRouter models are also compared with OpenRouter's public
model listing.
"""

import argparse
import base64
import json
import re
import struct
import sys
import tempfile
import urllib.request
import zlib
from collections.abc import Callable, Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from threading import Lock
from typing import Any

from roboz.agent import Agent
from roboz.endpoints.specs import ChatModelSpec
from roboz.exceptions import LLMOutputFormatError
from roboz.llm import LLMEndpoint, call_llm_api, get_completion, with_request_options
from roboz.models import Image, Message, Role
from roboz.shed.sandbox import Sandbox

from robozium.hub.utils import load_hub

OPENROUTER = "openrouter"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
MEMORY_LABEL = "Memory"
# Reasoning models spend output tokens before replying; leave room for one word.
MAX_OUTPUT_TOKENS = 1024
TIMEOUT_S = 45.0
PARALLEL_MODELS = 8
TEXT_PROMPT = "Reply with exactly one word: hello"
AGENT_GREETING = "hi"
IMAGE_PROMPT = "What colour is this square? Reply with one word."
CHECK_PROJECT = "model-check"

type Ping = Callable[[LLMEndpoint, list[Message]], str]
type BuildAgent = Callable[[LLMEndpoint], Agent]

_hub = cache(load_hub)
_build_lock = Lock()
type PublishedModels = Mapping[str, Mapping[str, Any]]


def _png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Encode a solid-colour RGB PNG without an imaging dependency."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes(rgb) * width
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"".join(
        [
            b"\x89PNG\r\n\x1a\n",
            chunk(b"IHDR", header),
            chunk(b"IDAT", zlib.compress(row * height)),
            chunk(b"IEND", b""),
        ]
    )


RED_SQUARE = Image(
    url="data:image/png;base64,"
    + base64.b64encode(_png(64, 64, (220, 20, 20))).decode(),
    name="red-square.png",
)


@dataclass(frozen=True)
class ModelResult:
    """Outcomes for one model; ``None`` means passed, a string explains why not.

    ``unavailable`` explains why the model could not be probed at all. It is a
    failure when ``required``, and a skip otherwise.
    """

    label: str
    endpoint: LLMEndpoint
    text: str | None = None
    image: str | None = None
    metadata: str | None = None
    unavailable: str | None = None
    required: bool = True

    @property
    def skipped(self) -> bool:
        return self.unavailable is not None and not self.required

    @property
    def passed(self) -> bool:
        return not (self.unavailable or self.text or self.image or self.metadata)


def mentions(reply: str, word: str) -> bool:
    """Accept a reply that contains the expected word, in any case, as a word."""
    return re.search(rf"\b{re.escape(word)}\b", reply, re.IGNORECASE) is not None


def metadata_problems(
    spec: ChatModelSpec, published: Mapping[str, Any] | None
) -> list[str]:
    """Compare one model's configuration with the provider's published model data."""
    if published is None:
        return ["not listed by the provider"]
    problems = []
    inputs = (published.get("architecture") or {}).get("input_modalities") or []
    if spec.accepts_images != ("image" in inputs):
        problems.append(
            f"accepts_images is {spec.accepts_images}, provider inputs are {inputs}"
        )
    context = published.get("context_length")
    if isinstance(context, int) and spec.max_context_tokens > context:
        problems.append(
            f"max_context_tokens {spec.max_context_tokens} exceeds provider {context}"
        )
    parameters = published.get("supported_parameters") or []
    if "tools" not in parameters:
        problems.append("provider does not list tool support")
    # Requests carry temperature unless the catalogue opts out; with
    # require_parameters, a model whose providers reject it cannot be routed.
    if spec.accepts_temperature != ("temperature" in parameters):
        problems.append(
            f"accepts_temperature is {spec.accepts_temperature},"
            f" provider {'lists' if 'temperature' in parameters else 'omits'} temperature"
        )
    return problems


def fetch_openrouter_models() -> dict[str, Mapping[str, Any]]:
    """Read OpenRouter's public listing; it needs no credentials."""
    with urllib.request.urlopen(OPENROUTER_MODELS_URL, timeout=TIMEOUT_S) as response:
        data = json.load(response)["data"]
    return {model["id"]: model for model in data}


def _live_ping(endpoint: LLMEndpoint, messages: list[Message]) -> str:
    reply, _ = call_llm_api(endpoint, messages, timeout_s=TIMEOUT_S, max_attempts=1)
    return reply


def is_tool_call(reply: str, agent: Agent) -> bool:
    """Judge a reply with the application's own parser, without repair attempts."""
    try:
        get_completion(
            messages=[Message(role=Role.USER, content=AGENT_GREETING)],
            call_llm_api=lambda _: (reply, {}),
            active_tools=list(agent.active_tools.values()),
            tries=1,
        )
    except LLMOutputFormatError:
        return False
    return True


def _failure(error: Exception) -> str:
    return f"{type(error).__name__}: {error}"


def _probes(
    endpoint: LLMEndpoint, ping: Ping, agent: Agent | None
) -> tuple[str | None, str | None]:
    """Return text and image failures for one reachable endpoint.

    With an agent, the text probe sends its full system prompt and a greeting,
    as the application's first turn does, and expects a valid tool call.
    """

    def probe(messages: list[Message], accept: Callable[[str], bool]) -> str | None:
        try:
            reply = ping(endpoint, messages)
        except Exception as error:  # Report every provider failure, then continue.
            return _failure(error)
        return None if accept(reply) else f"unexpected reply {reply[:80]!r}"

    if agent is None:
        text = probe(
            [Message(role=Role.USER, content=TEXT_PROMPT)],
            lambda reply: mentions(reply, "hello"),
        )
    else:
        text = probe(
            [
                Message(role=Role.SYSTEM, content=agent.full_system_prompt),
                Message(role=Role.USER, content=AGENT_GREETING),
            ],
            lambda reply: is_tool_call(reply, agent),
        )
    if not endpoint.accepts_images:
        return text, None
    image = probe(
        [Message(role=Role.USER, content=IMAGE_PROMPT, images=[RED_SQUARE])],
        lambda reply: mentions(reply, "red"),
    )
    return text, image


def check_model(
    label: str,
    configured: LLMEndpoint,
    *,
    required: bool,
    published: PublishedModels | None,
    ping: Ping,
    build_agent: BuildAgent | None = None,
) -> ModelResult:
    """Probe one model with its configured request options and a small output limit.

    ``build_agent`` supplies the agent whose system prompt the model receives;
    without it, the model gets a plain one-word prompt.
    """
    endpoint = with_request_options(
        configured,
        extra_body={**(configured.extra_body or {}), "max_tokens": MAX_OUTPUT_TOKENS},
    )
    try:
        endpoint.materialize()
    except ValueError as error:  # The adapter's missing-credential error.
        return ModelResult(label, endpoint, unavailable=str(error), required=required)
    except Exception as error:  # Any other setup error is a failure, never a skip.
        return ModelResult(label, endpoint, unavailable=_failure(error))
    agent = None if build_agent is None else build_agent(configured)
    text, image = _probes(endpoint, ping, agent)
    metadata = None
    if published is not None and endpoint.api_name == OPENROUTER:
        spec = ChatModelSpec(
            endpoint.model_name,
            endpoint.max_context_tokens,
            endpoint.accepts_images,
            endpoint.accepts_temperature,
        )
        metadata = "; ".join(metadata_problems(spec, published.get(endpoint.model_name)))
    return ModelResult(label, endpoint, text, image, metadata or None)


def _status(failure: str | None, *, applies: bool = True) -> str:
    if not applies:
        return "-"
    return "ok" if failure is None else f"FAIL ({failure})"


def format_result(result: ModelResult) -> str:
    """Render one stable, greppable line per model."""
    endpoint = result.endpoint
    model = f"{endpoint.api_name} {endpoint.model_name} [{result.label}]"
    if result.unavailable is not None:
        return f"{'SKIP' if result.skipped else 'FAIL'} {model}: {result.unavailable}"
    return (
        f"{'PASS' if result.passed else 'FAIL'} {model}"
        f" | text {_status(result.text)}"
        f" | image {_status(result.image, applies=endpoint.accepts_images)}"
        f" | metadata {_status(result.metadata, applies=endpoint.api_name == OPENROUTER)}"
    )


def configured_models() -> dict[str, LLMEndpoint]:
    """Return every live chat model the application uses, by dropdown label."""
    settings = _hub().settings
    models = {**settings.models, MEMORY_LABEL: settings.memory_endpoint}
    return {
        label: endpoint
        for label, endpoint in models.items()
        if isinstance(endpoint, LLMEndpoint)
    }


def build_orchestrator(endpoint: LLMEndpoint) -> Agent:
    """Build the application's orchestrator for one model in a throwaway project."""
    with _build_lock, tempfile.TemporaryDirectory(prefix="model-check-") as hub_dir:
        root, _ = (
            _hub()
            .configure_deployment(
                Sandbox(Path(hub_dir)), CHECK_PROJECT, endpoint_getter=lambda: endpoint
            )
            .build()
        )
    return root


def run_checks(
    models: Mapping[str, LLMEndpoint],
    *,
    required: bool,
    published: PublishedModels | None,
    ping: Ping,
    build_agent: BuildAgent | None = None,
) -> list[ModelResult]:
    """Probe models concurrently and return results in configuration order.

    Every model except the memory model is probed through ``build_agent``.
    """

    def check(item: tuple[str, LLMEndpoint]) -> ModelResult:
        label, endpoint = item
        try:
            return check_model(
                label,
                endpoint,
                required=required,
                published=published,
                ping=ping,
                build_agent=None if label == MEMORY_LABEL else build_agent,
            )
        except Exception as error:  # One model's defect must not hide the others.
            return ModelResult(label, endpoint, unavailable=_failure(error))

    with ThreadPoolExecutor(PARALLEL_MODELS) as pool:
        return list(pool.map(check, models.items()))


def main(argv: Sequence[str] | None = None) -> int:
    """Check configured models and return a failing status for any problem."""
    models = configured_models()
    providers = sorted({endpoint.api_name for endpoint in models.values()})
    parser = argparse.ArgumentParser(
        prog="scripts/model_check.py",
        description="Ping configured chat models with text and images.",
    )
    parser.add_argument(
        "--provider",
        action="append",
        choices=providers,
        help="Check only this provider and fail if its key is missing (repeatable)",
    )
    args = parser.parse_args(argv)
    selected = {
        label: endpoint
        for label, endpoint in models.items()
        if args.provider is None or endpoint.api_name in args.provider
    }
    published = None
    if any(endpoint.api_name == OPENROUTER for endpoint in selected.values()):
        try:
            published = fetch_openrouter_models()
        except Exception as error:  # Without the listing, metadata cannot be judged.
            print(f"FAIL {OPENROUTER} model listing: {_failure(error)}")
            return 1
    try:
        results = run_checks(
            selected,
            required=args.provider is not None,
            published=published,
            ping=_live_ping,
            build_agent=build_orchestrator,
        )
    finally:
        # Configured models may share one client, so close each once, after all probes.
        for client in {id(e.client): e.client for e in models.values()}.values():
            client.close()
    for result in results:
        print(format_result(result))
    if all(result.skipped for result in results):
        print("FAIL no chat model was checked")
        return 1
    return 0 if all(result.passed or result.skipped for result in results) else 1


if __name__ == "__main__":
    sys.exit(main())
