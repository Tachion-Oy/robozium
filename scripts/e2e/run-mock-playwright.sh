#!/usr/bin/env bash
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${REPO_ROOT}/scripts/env.sh"
if [[ -z "${ROBOZIUM_E2E_PYTHON:-}" ]]; then
    ROBOZIUM_E2E_PYTHON="$(uv run --locked --project "$REPO_ROOT" python -c 'import sys; print(sys.executable)')"
fi
export ROBOZIUM_E2E_PYTHON
# The controller needs only Python's standard library, independently of the candidate.
exec python3 "${REPO_ROOT}/scripts/e2e/run.py" "$@"
