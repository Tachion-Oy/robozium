from os import environ
from pathlib import Path
from typing import Final

from roboz.llm import with_openrouter_policy
from roboz.shed.sandbox import Sandbox

from robozium.hub import environment as env
from robozium.hub.application import AttachmentSettings, DependencyHealthSettings
from robozium.hub.logging import HubLoggingConfig
from robozium.model_catalogue.providers import cerebras, groq, openrouter

NAME: Final = "Robozium"
SANDBOX: Final = Sandbox(
    root=Path(environ.get(env.HUB_ROOT, f"../{NAME}-Hub")),
    readonly="readonly",
    shared="workspace",
    projects="projects",
    logs=Path("conversation_logs"),
    snapshots=Path("conversation_snapshots"),
    memory=Path("persistent_memory"),
)
LOGGING: Final = HubLoggingConfig(
    path=Path(environ.get(env.LOG_DIR, str(HubLoggingConfig.path.parent)))
    / HubLoggingConfig.path.name
)
DEPENDENCY_HEALTH: Final = DependencyHealthSettings(interval_s=60.0, timeout_s=20.0)
ATTACHMENTS: Final = AttachmentSettings(
    max_images=4,
    max_image_bytes=10 * 1024 * 1024,
    max_pixels=25_000_000,
    max_run_bytes=100 * 1024 * 1024,
)

OPENROUTER: Final = openrouter.configured()
GLM: Final = with_openrouter_policy(OPENROUTER.z_ai__glm_5_3, reasoning_effort="low")
FLASH: Final = with_openrouter_policy(
    OPENROUTER.z_ai__glm_5_3_flash, reasoning_effort="low"
)
GPT_OSS: Final = cerebras.configured().gpt_oss_120b
MEMORY_ENDPOINT: Final = with_openrouter_policy(
    OPENROUTER.z_ai__glm_5_3, reasoning_effort="high"
)
# Labels tell users which models answer quickly and which reason longer for hard tasks.
FAST_MODELS: Final = {
    "GLM-5.3 FlashX": OPENROUTER.z_ai__glm_5_3_flashx,
    "DeepSeek V4.1 Flash": OPENROUTER.deepseek__deepseek_v4_1_flash,
    "Kimi K3": OPENROUTER.moonshotai__kimi_k3,
    "Qwen3.8 Flash": OPENROUTER.qwen__qwen3_8_flash,
    "MiniMax M3.1 Flash": OPENROUTER.minimax__minimax_m3_1_flash,
}
DEEP_REASONING_MODELS: Final = {
    "DeepSeek V4 Pro": OPENROUTER.deepseek__deepseek_v4_pro_0813,
    "Kimi K3.1 Pro": OPENROUTER.moonshotai__kimi_k3_1_pro,
    "Qwen3.8 Max": OPENROUTER.qwen__qwen3_8_max_0902,
    "Gemini 4 Argon": OPENROUTER.google__gemini_4_argon,
    "Claude Sonnet 5.5": OPENROUTER.anthropic__claude_sonnet_5_5,
    "GPT-6.1 Sol": OPENROUTER.openai__gpt_6_1_sol,
    "Grok 4.7": OPENROUTER.x_ai__grok_4_7,
}
MODELS: Final = {
    "GLM-5.3 · Fast · OpenRouter": GLM,
    "GLM-5.3 Flash · Fast · OpenRouter": FLASH,
    **{
        f"{name} · Fast · OpenRouter": with_openrouter_policy(
            endpoint, reasoning_effort="low"
        )
        for name, endpoint in FAST_MODELS.items()
    },
    "GPT-OSS-120B · Fast · Cerebras": GPT_OSS,
    **{
        f"{name} · Deep reasoning · OpenRouter": with_openrouter_policy(
            endpoint, reasoning_effort="high"
        )
        for name, endpoint in DEEP_REASONING_MODELS.items()
    },
}
DEFAULT_MODEL: Final = GLM
SUBAGENTS: Final = ()
TRANSCRIPTION_ENDPOINT: Final = groq.configured().whisper_large_v3_turbo
ADDITIONAL_DEPENDENCIES: Final = None
