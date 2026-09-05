#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROBOSPRAWL_ROOT"
uv run --locked pytest
npm --prefix web run test:run
npm --prefix web run lint
bash scripts/e2e/run-mock-playwright.sh --project=chromium
bash scripts/e2e/run-mock-playwright.sh --project=firefox
