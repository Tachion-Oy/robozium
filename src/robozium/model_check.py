"""Ping every catalogue chat model and compare it with published model data.

Run ``uv run python -m robozium.model_check``. Each chat model receives one
short text prompt and, when its catalogue entry accepts images, one tiny image.
OpenRouter models are also compared with OpenRouter's public model listing.
Every request uses live provider credentials and a small output limit.
"""

import argparse
import base64
import json
import struct
import sys
import urllib.request
import zlib
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from roboz.endpoints.catalog import Catalog
from roboz.endpoints.specs import ChatModelSpec, ModelSpec
from roboz.llm import LLMEndpoint, call_llm_api, with_request_options
from roboz.llm.openrouter import openrouter_request_options
from roboz.models import Image, Message, Role

from robozium.model_catalogue import providers

OPENROUTER = "openrouter"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
# Reasoning models spend output tokens before replying; leave room for one word.
MAX_OUTPUT_TOKENS = 256
TIMEOUT_S = 60.0
TEXT_PROMPT = "Reply with exactly one word: hello"
IMAGE_PROMPT = "What colour is this square? Reply with one word."

type Ping = Callable[[LLMEndpoint, Message], str]
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
    """Outcomes for one model; ``None`` means passed, a string explains why not."""

    provider: str
    spec: ChatModelSpec
    text: str | None
    image: str | None
    metadata: str | None
    skipped: str | None = None

    @property
    def passed(self) -> bool:
        return self.skipped is None and not (self.text or self.image or self.metadata)


def mentions(reply: str, word: str) -> bool:
    """Accept a reply that contains the expected word in any case."""
    return word in reply.casefold()


def metadata_problems(
    spec: ChatModelSpec, published: Mapping[str, Any] | None
) -> list[str]:
    """Compare one catalogue entry with the provider's published model data."""
    if published is None:
        return ["not listed by the provider"]
    problems = []
    inputs = published.get("architecture", {}).get("input_modalities", [])
    if spec.accepts_images != ("image" in inputs):
        problems.append(
            f"accepts_images is {spec.accepts_images}, provider inputs are {inputs}"
        )
    context = published.get("context_length")
    if isinstance(context, int) and spec.max_context_tokens > context:
        problems.append(
            f"max_context_tokens {spec.max_context_tokens} exceeds provider {context}"
        )
    if "tools" not in published.get("supported_parameters", []):
        problems.append("provider does not list tool support")
    return problems


def fetch_openrouter_models() -> dict[str, Mapping[str, Any]]:
    """Read OpenRouter's public listing; it needs no credentials."""
    with urllib.request.urlopen(OPENROUTER_MODELS_URL, timeout=TIMEOUT_S) as response:
        data = json.load(response)["data"]
    return {model["id"]: model for model in data}


def _live_ping(endpoint: LLMEndpoint, message: Message) -> str:
    reply, _ = call_llm_api(endpoint, [message], timeout_s=TIMEOUT_S, max_attempts=2)
    return reply


def _check_endpoint(
    endpoint: LLMEndpoint, spec: ChatModelSpec, ping: Ping
) -> tuple[str | None, str | None]:
    """Return text and image failures for one reachable endpoint."""

    def probe(message: Message, word: str) -> str | None:
        try:
            reply = ping(endpoint, message)
        except Exception as error:  # Report every provider failure, then continue.
            return f"{type(error).__name__}: {error}"
        return None if mentions(reply, word) else f"unexpected reply {reply[:80]!r}"

    text = probe(Message(role=Role.USER, content=TEXT_PROMPT), "hello")
    if not spec.accepts_images:
        return text, None
    image = probe(
        Message(role=Role.USER, content=IMAGE_PROMPT, images=[RED_SQUARE]), "red"
    )
    return text, image


def _probe_endpoint(catalog: Catalog[ModelSpec], attribute: str) -> LLMEndpoint:
    """Select the endpoint with the application's request policy and a small limit."""
    endpoint = getattr(catalog, attribute)
    assert isinstance(endpoint, LLMEndpoint)
    options: dict[str, object] = {"max_tokens": MAX_OUTPUT_TOKENS}
    if catalog.api_name == OPENROUTER:
        options |= openrouter_request_options(reasoning_effort="low")
    return with_request_options(endpoint, extra_body=options)


def check_catalog(
    catalog: Catalog[ModelSpec],
    *,
    required: bool,
    published: PublishedModels | None,
    ping: Ping,
) -> Iterable[ModelResult]:
    """Check each chat model; a provider without a key fails only when required."""
    for attribute, spec in catalog.models_by_attribute.items():
        if not isinstance(spec, ChatModelSpec):
            continue
        endpoint = _probe_endpoint(catalog, attribute)
        try:
            endpoint.materialize()
        except ValueError as error:
            if required:
                yield ModelResult(catalog.api_name, spec, str(error), None, None)
            else:
                yield ModelResult(
                    catalog.api_name, spec, None, None, None, skipped=str(error)
                )
            continue
        try:
            text, image = _check_endpoint(endpoint, spec, ping)
        finally:
            endpoint.client.close()
        metadata = None
        if published is not None:
            metadata = "; ".join(metadata_problems(spec, published.get(spec.model_id)))
        yield ModelResult(catalog.api_name, spec, text, image, metadata or None)


def _status(failure: str | None, *, applies: bool = True) -> str:
    if not applies:
        return "-"
    return "ok" if failure is None else f"FAIL ({failure})"


def format_result(result: ModelResult) -> str:
    """Render one stable, greppable line per model."""
    model = f"{result.provider} {result.spec.model_id}"
    if result.skipped is not None:
        return f"SKIP {model}: {result.skipped}"
    outcome = "PASS" if result.passed else "FAIL"
    return (
        f"{outcome} {model}"
        f" | text {_status(result.text)}"
        f" | image {_status(result.image, applies=result.spec.accepts_images)}"
        f" | metadata {_status(result.metadata, applies=result.provider == OPENROUTER)}"
    )


def _catalogs() -> dict[str, Catalog[ModelSpec]]:
    return {name: getattr(providers, name) for name in providers.__all__}


def main(argv: Sequence[str] | None = None) -> int:
    """Check catalogue models and return a failing status for any problem."""
    catalogs = _catalogs()
    parser = argparse.ArgumentParser(
        prog="python -m robozium.model_check",
        description="Ping catalogue chat models with text and images.",
    )
    parser.add_argument(
        "--provider",
        action="append",
        choices=sorted(catalogs),
        help="Check only this provider and fail if its key is missing (repeatable)",
    )
    args = parser.parse_args(argv)
    selected = args.provider or list(catalogs)
    published = fetch_openrouter_models() if OPENROUTER in selected else None
    failed = False
    for name in selected:
        for result in check_catalog(
            catalogs[name],
            required=args.provider is not None,
            published=published if name == OPENROUTER else None,
            ping=_live_ping,
        ):
            print(format_result(result), flush=True)
            failed |= result.skipped is None and not result.passed
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
