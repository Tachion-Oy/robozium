#!/bin/sh
# Platform adaptation only; all application inputs are supplied by the caller.
set -eu
user_variable=$1
base=$2
encrypted=$3
plain=$4
lock=$5
shift 5
mkdir -p "$(dirname "$lock")"
if ! mkdir "$lock" 2>/dev/null; then echo "Already running: $lock" >&2; exit 1; fi
trap 'rmdir "$lock"' EXIT
if ! printenv "$user_variable" >/dev/null; then
  security=$(docker info --format '{{json .SecurityOptions}}')
  case "$security" in
    *rootless*) export "$user_variable=0:0" ;;
    *) export "$user_variable=$(id -u):$(id -g)" ;;
  esac
fi
set -- -f "$base" "$@"
if [ -f "$plain" ]; then set -- --env-file "$plain" "$@"; fi
if [ -f "$encrypted" ]; then set -- --env-file "$encrypted" "$@"; fi
docker compose "$@" &
child=$!
trap 'kill -TERM "$child" 2>/dev/null || :; wait "$child" 2>/dev/null || :; exit 143' TERM
wait "$child"
