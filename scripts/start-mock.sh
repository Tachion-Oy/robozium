#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec process-compose -f process-compose.yaml --disable-dotenv --no-server -t=false up mock
