#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec sh scripts/compose.sh mock ROBOZIUM_API_USER compose.yaml .env.encrypt .env .runtime/launch.lock up --build --exit-code-from api
