"""Scripted provider boundary for exercising real per-run endpoint routing."""

import json
from pathlib import Path
from types import SimpleNamespace

from roboz.dependencies import DependencyRoute, LazyExternalDependency
from roboz.llm import EndpointLike, LLMEndpoint, with_request_options
from roboz.tooling import Ctx

MODEL_REQUESTS_FILE = ".mock-model-requests.jsonl"


def model_selection_endpoint(
    endpoint: EndpointLike, project_root: Path
) -> EndpointLike:
    """Use cached scripted clients selected by the shared live endpoint route.

    Each factory call owns its response sequence and clients. The journal records
    actual provider requests so browser tests can verify which model was called.
    """
    ctx = Ctx(endpoint=endpoint)
    models: dict[str, LazyExternalDependency[LLMEndpoint]] = {}
    request_count = 0

    def selected() -> LazyExternalDependency[LLMEndpoint]:
        (dependency,) = ctx.external_dependencies()
        if dependency.dependency_id not in models:
            metadata = dependency.redacted_metadata()

            def construct() -> LLMEndpoint:
                def create(**request):
                    nonlocal request_count
                    request_count += 1
                    with (project_root / MODEL_REQUESTS_FILE).open(
                        "a", encoding="utf-8"
                    ) as journal:
                        journal.write(
                            json.dumps(
                                {
                                    "model_id": f"model:{metadata['api_name']}:{request['model']}",
                                    "request": request_count,
                                    "extra_body": request.get("extra_body"),
                                }
                            )
                            + "\n"
                        )
                    response = {
                        "action": "prompt_user",
                        "rationale": "wait for the next model selection",
                        "value": f"Model request {request_count} completed. Reply to continue.",
                    }
                    return SimpleNamespace(
                        choices=[
                            SimpleNamespace(
                                message=SimpleNamespace(content=json.dumps(response))
                            )
                        ],
                        usage=None,
                    )

                return LLMEndpoint(
                    client=SimpleNamespace(
                        chat=SimpleNamespace(completions=SimpleNamespace(create=create))
                    ),
                    api_name=metadata["api_name"],
                    model_name=metadata["model_name"],
                    stream=False,
                )

            models[dependency.dependency_id] = LazyExternalDependency(
                dependency.dependency_id,
                dependency.kind,
                metadata,
                construct,
            )
        return models[dependency.dependency_id]

    return with_request_options(
        DependencyRoute(selected), extra_body={"reasoning": {"effort": "low"}}
    )
