"""Environment-variable names and the Environment editor's startup policy."""

from typing import Final

MODE: Final = "ROBOZIUM_MODE"
CONFIG: Final = "ROBOZIUM_CONFIG"
WEB_PORT: Final = "ROBOZIUM_WEB_PORT"
HUB_ROOT: Final = "ROBOZIUM_HUB_ROOT"
LOCAL_DIRS: Final = "ROBOZIUM_LOCAL_DIRS"
ENCRYPTED_ENV_PATH: Final = "ROBOZIUM_ENCRYPTED_ENV_PATH"
HOST_SCRIPT_SOCKET: Final = "ROBOZIUM_HOST_SCRIPT_SOCKET"
LOG_DIR: Final = "ROBOZIUM_LOG_DIR"
HOST_HUB_DIR: Final = "ROBOZIUM_HOST_HUB_DIR"
HOST_LOG_DIR: Final = "ROBOZIUM_HOST_LOG_DIR"
HOST_SOCKET_DIR: Final = "ROBOZIUM_HOST_SOCKET_DIR"
API_USER: Final = "ROBOZIUM_API_USER"
ENV_PASSWORD: Final = "ROBOZ_ENV_PASSWORD"
COMPOSE_PROJECT_NAME: Final = "COMPOSE_PROJECT_NAME"
STREAM_MOCK_DELAY_S: Final = "ROBOZIUM_STREAM_MOCK_DELAY_S"
STREAM_MOCK_START_DELAY_S: Final = "ROBOZIUM_STREAM_MOCK_START_DELAY_S"

# These editable values are consumed before the API can unlock secrets.
STARTUP_NAMES: Final = frozenset({WEB_PORT, HUB_ROOT, LOCAL_DIRS})

# Supplied by the launcher or runtime; never editable through the HUD.
CONTROLLED_NAMES: Final = frozenset(
    {
        MODE,
        CONFIG,
        ENCRYPTED_ENV_PATH,
        HOST_SCRIPT_SOCKET,
        LOG_DIR,
        HOST_HUB_DIR,
        HOST_LOG_DIR,
        HOST_SOCKET_DIR,
        ENV_PASSWORD,
        COMPOSE_PROJECT_NAME,
        API_USER,
    }
)
