#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROBOSPRAWL_ROOT"
uv sync --locked
npm --prefix web ci
npm --prefix web exec -- playwright install chromium firefox webkit
