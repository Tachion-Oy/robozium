#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cd "$ROBOSPRAWL_ROOT"
uv run --locked python scripts/stage-wheel-sources.py
for package in core shed openai application; do
    uv build --no-sources --wheel --out-dir "$ROBOSPRAWL_ROOT/.artifacts/wheels" ".artifacts/wheel-sources/$package"
done
uv venv --clear .artifacts/wheel-venv
uv pip install --python .artifacts/wheel-venv/bin/python .artifacts/wheels/*.whl
.artifacts/wheel-venv/bin/python - <<'WHEEL_SMOKE'
from importlib.metadata import version
from pathlib import Path
import sys
import robosprawl, roboz, roboz_shed, roboz_openai
from fastapi.testclient import TestClient
from robosprawl.api.app import mock_app
for module in (robosprawl, roboz, roboz_shed, roboz_openai):
    assert Path(module.__file__).is_relative_to(Path(sys.prefix)), module.__file__
for package in ("robosprawl", "roboz", "roboz-shed", "roboz-openai"):
    print(package, version(package))
with TestClient(mock_app) as client:
    assert client.get("/ready").status_code == 200
    assert client.get("/models").status_code == 200
print("Wheel installation and mock startup passed")
WHEEL_SMOKE
