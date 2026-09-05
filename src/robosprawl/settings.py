"""Validated deployment choices, independent of application startup."""

from typing import Any, Self
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, model_validator
from roboz.llm import LLMEndpoint
from roboz.tooling import LazyExternalDependency
from roboz_openai import openai_endpoint


class EndpointSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, str_strip_whitespace=True)
    label: str = Field(min_length=1)
    api_name: str = Field(min_length=1)
    model: str = Field(min_length=1)
    base_url: str
    api_key_env: str = Field(pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")
    max_context_tokens: int = Field(gt=0)
    timeout_s: float = Field(default=60.0, gt=0, allow_inf_nan=False)
    stream: bool = True
    extra_body: dict[str, Any] | None = None

    @model_validator(mode="after")
    def validate_url(self) -> Self:
        url = urlsplit(self.base_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
        ):
            raise ValueError(
                "base_url must be HTTP(S), without credentials, query, or fragment"
            )
        return self

    def endpoint(self) -> LazyExternalDependency[LLMEndpoint]:
        return openai_endpoint(**self.model_dump(exclude={"label"}))


def _default_endpoints() -> dict[str, EndpointSettings]:
    def glm(label: str, model: str, effort: str) -> EndpointSettings:
        return EndpointSettings(
            label=label,
            model=model,
            api_name="openrouter",
            base_url="https://openrouter.ai/api/v1",
            api_key_env="OPENROUTER_API_KEY",
            max_context_tokens=1_310_720,
            extra_body={
                "provider": {"sort": "throughput", "require_parameters": True},
                "reasoning": {"effort": effort},
            },
        )

    return {
        "glm": glm("GLM-5.3 · OpenRouter", "z-ai/glm-5.3", "low"),
        "glm-flash": glm("GLM-5.3 Flash · OpenRouter", "z-ai/glm-5.3-flash", "low"),
        "gpt-oss": EndpointSettings(
            label="GPT-OSS-120B · Cerebras",
            model="gpt-oss-120b",
            api_name="cerebras",
            base_url="https://api.cerebras.ai/v1",
            api_key_env="CEREBRAS_API_KEY",
            max_context_tokens=131072,
        ),
        "memory": glm("Librarian", "z-ai/glm-5.3", "high"),
    }


class DeploymentSettings(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    endpoints: dict[str, EndpointSettings] = Field(default_factory=_default_endpoints)
    selectable_models: tuple[str, ...] = ("glm", "glm-flash", "gpt-oss")
    default_model: str = "glm"
    memory_model: str = "memory"

    @model_validator(mode="after")
    def validate_references(self) -> Self:
        if (
            not self.selectable_models
            or self.default_model not in self.selectable_models
        ):
            raise ValueError("default_model must be in nonempty selectable_models")
        required = {*self.selectable_models, self.memory_model}
        missing = required - self.endpoints.keys()
        if missing:
            raise ValueError(f"unknown endpoint references: {sorted(missing)}")
        selected = [self.endpoints[key] for key in self.selectable_models]
        if len({(item.api_name, item.model) for item in selected}) != len(selected):
            raise ValueError("selectable model identities must be unique")
        if len({item.label for item in selected}) != len(selected):
            raise ValueError("selectable model labels must be unique")
        services: dict[str, tuple[str, str]] = {}
        for item in self.endpoints.values():
            service = (item.base_url.rstrip("/"), item.api_key_env)
            if item.api_name in services and services[item.api_name] != service:
                raise ValueError(
                    "use a distinct api_name for each service/credential binding"
                )
            services[item.api_name] = service
        return self
