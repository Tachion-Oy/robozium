#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROBOSPRAWL_ROOT"
uv sync --locked --dev
uv run pytest --cov-fail-under=90
uv run ruff check src tests scripts
uv run pyright
npm --prefix web run typecheck
npm --prefix web run test:run
npm --prefix web run lint
bash scripts/e2e/run-mock-playwright.sh
