#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/env.sh"
cd "$REPO_ROOT"
exec uv run --locked python -m tests.support.browser "$@"
