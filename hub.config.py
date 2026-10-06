from os import environ
from pathlib import Path
from typing import Final

from roboz.endpoints.inventory import cerebras, groq, openrouter
from roboz.llm import with_openrouter_policy
from roboz.shed.sandbox import Sandbox

from robozium.hub.application import DependencyHealthSettings
from robozium.hub.logging import HubLoggingConfig

NAME: Final = "Robozium"
SANDBOX: Final = Sandbox(
    root=Path(environ.get("ROBOZIUM_HUB_ROOT", f"../{NAME}-Hub")),
    readonly="readonly",
    shared="workspace",
    projects="projects",
    logs=Path("conversation_logs"),
    snapshots=Path("conversation_snapshots"),
    memory=Path("persistent_memory"),
)
LOGGING: Final = HubLoggingConfig(
    path=Path(environ.get("ROBOZIUM_LOG_DIR", ".runtime/logs")) / "backend.jsonl"
)
DEPENDENCY_HEALTH: Final = DependencyHealthSettings(interval_s=60.0, timeout_s=20.0)

OPENROUTER: Final = openrouter.configured()
GLM: Final = with_openrouter_policy(OPENROUTER.z_ai__glm_5_3, reasoning_effort="low")
FLASH: Final = with_openrouter_policy(
    OPENROUTER.z_ai__glm_5_3_flash, reasoning_effort="low"
)
GPT_OSS: Final = cerebras.configured().gpt_oss_120b
MEMORY_ENDPOINT: Final = with_openrouter_policy(
    OPENROUTER.z_ai__glm_5_3, reasoning_effort="high"
)
MODELS: Final = {
    "GLM-5.3 · OpenRouter": GLM,
    "GLM-5.3 Flash · OpenRouter": FLASH,
    "GPT-OSS-120B · Cerebras": GPT_OSS,
}
DEFAULT_MODEL: Final = GLM
SUBAGENTS: Final = ()
TRANSCRIPTION_ENDPOINT: Final = groq.configured().whisper_large_v3_turbo
ADDITIONAL_DEPENDENCIES: Final = None
