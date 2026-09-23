#!/usr/bin/env bash
# Source before installation, launch, or checks. All generated files stay local.
export ROBOZIUM_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export TMPDIR="${ROBOZIUM_ROOT}/.artifacts/tmp"
export PYTHONPYCACHEPREFIX="${ROBOZIUM_ROOT}/.artifacts/pycache"
export UV_CACHE_DIR="${ROBOZIUM_ROOT}/.artifacts/uv-cache"
export UV_PYTHON_INSTALL_DIR="${ROBOZIUM_ROOT}/.artifacts/python"
export UV_TOOL_DIR="${ROBOZIUM_ROOT}/.artifacts/uv-tools"
export npm_config_cache="${ROBOZIUM_ROOT}/.artifacts/npm-cache"
export PLAYWRIGHT_BROWSERS_PATH="${ROBOZIUM_ROOT}/.artifacts/browsers"
export XDG_CACHE_HOME="${ROBOZIUM_ROOT}/.artifacts/cache"
export NEXT_TELEMETRY_DISABLED=1
export DO_NOT_TRACK=1
export GIT_OPTIONAL_LOCKS=0
mkdir -p "$TMPDIR" "$PYTHONPYCACHEPREFIX" "$UV_CACHE_DIR" "$npm_config_cache" "$PLAYWRIGHT_BROWSERS_PATH" "$XDG_CACHE_HOME"
