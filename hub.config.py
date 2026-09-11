from pathlib import Path
from typing import Final

from roboshed.capabilities import Compactification
from roboshed.deployments.robosprawl import RoboSprawl
from roboshed.sandbox import Sandbox
from roboshed.skills import robosprawl
from roboz.deployment import Capability
from roboz.llm import with_openrouter_policy
from roboz.runtime import Output
from roboz_endpoints import cerebras, openrouter

from robosprawl.hub.application import DependencyHealthSettings
from robosprawl.hub.logging import HubLoggingConfig

NAME: Final = "RoboSprawl"
SANDBOX: Final = Sandbox(
    root=Path(f"../{NAME}"),
    readonly="readonly",
    shared="workspace",
    projects="projects",
    logs=Path("conversation_logs"),
    snapshots=Path("conversation_snapshots"),
    memory=Path("persistent_memory"),
)
LOGGING: Final = HubLoggingConfig()
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
CAPABILITIES: Final = (
    Capability(auto_loaded_skills=(robosprawl,)),
    Compactification(threshold_percent=60.0),
)
SUBAGENTS: Final = ()
INTERACTION_MODE: Final = Output.API
DEPLOYMENT: Final = RoboSprawl(
    memory_endpoint=MEMORY_ENDPOINT,
    additional_capabilities=CAPABILITIES,
    subagents=SUBAGENTS,
    interaction_mode=INTERACTION_MODE,
)
TRANSCRIPTION_ENDPOINT: Final = None
DEPENDENCY_REGISTRY: Final = None
