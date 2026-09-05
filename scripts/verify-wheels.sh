#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROBOSPRAWL_ROOT"
# Optional input is a fresh directory containing candidate Roboz distributions.
if [[ $# -gt 0 ]]; then
    candidate_dir="$(realpath "$1")"
else
    candidate_dir="$(mktemp -d)"
    uv build --no-sources --all-packages --project ../roboz --out-dir "$candidate_dir"
fi
uv build --no-sources --out-dir "$candidate_dir"
uv run --locked twine check "$candidate_dir"/*
uv run --locked python scripts/check_distributions.py --dist "$candidate_dir"
echo "Verified candidate distributions: $candidate_dir"
