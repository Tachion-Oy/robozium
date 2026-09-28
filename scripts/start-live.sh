#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec process-compose -f process-compose.yaml -e .env.encrypt -e .env --no-server -t=false up "live-$(uname -s)"
