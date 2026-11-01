"""Environment-variable names, editor limits, and controlled settings."""

from typing import Final

MODE: Final = "ROBOZIUM_MODE"
CONFIG: Final = "ROBOZIUM_CONFIG"
HUB_ROOT: Final = "ROBOZIUM_HUB_ROOT"
ENCRYPTED_ENV_PATH: Final = "ROBOZIUM_ENCRYPTED_ENV_PATH"
HOST_SCRIPT_SOCKET: Final = "ROBOZIUM_HOST_SCRIPT_SOCKET"
LOG_DIR: Final = "ROBOZIUM_LOG_DIR"
ENV_PASSWORD: Final = "ROBOZ_ENV_PASSWORD"
STREAM_MOCK_DELAY_S: Final = "ROBOZIUM_STREAM_MOCK_DELAY_S"
STREAM_MOCK_START_DELAY_S: Final = "ROBOZIUM_STREAM_MOCK_START_DELAY_S"
# Settings entries the Repositories section owns: the URL and a private repository's deploy key.
REPOSITORY_PREFIX: Final = "ROBOZIUM_REPOSITORY_"
DEPLOY_KEY_PREFIX: Final = "ROBOZIUM_DEPLOY_KEY_"
REPOSITORY_ENTRIES: Final = (REPOSITORY_PREFIX, DEPLOY_KEY_PREFIX)

MAX_ENV_BYTES: Final = 256 * 1024
MAX_PACKAGE_BYTES: Final = 32 * 1024 * 1024
MAX_UNLOCK_BODY_BYTES: Final = 4096
MAX_PASSWORD_CHARS: Final = 1024

# Supplied by the desktop runtime; never editable through the HUD.
CONTROLLED_NAMES: Final = frozenset(
    {
        MODE,
        CONFIG,
        HUB_ROOT,
        ENCRYPTED_ENV_PATH,
        HOST_SCRIPT_SOCKET,
        LOG_DIR,
        ENV_PASSWORD,
    }
)
