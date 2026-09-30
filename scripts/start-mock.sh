#!/bin/sh
# Launch the mock application.
set -eu

cd "$(dirname "$0")/.."

set -- docker compose
if [ -f .env.encrypt ]; then set -- "$@" --env-file .env.encrypt; fi
if [ -f .env ]; then set -- "$@" --env-file .env; fi
set -- "$@" -f compose.yaml

umask 077
launch_lock=.runtime/launch.lock
mkdir -p .runtime
if ! mkdir "$launch_lock" 2>/dev/null; then
  echo "Already running: $launch_lock" >&2
  exit 1
fi

compose_pid=
cleanup() {
  trap - EXIT INT TERM
  if [ -n "$compose_pid" ]; then
    kill -TERM "$compose_pid" 2>/dev/null || :
    wait "$compose_pid" 2>/dev/null || :
  fi
  rmdir "$launch_lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export ROBOZIUM_MODE=mock
export ROBOZIUM_HOST_HUB_DIR=.runtime/mock-hub
export ROBOZIUM_HOST_LOG_DIR=.runtime/mock-logs
export ROBOZIUM_HOST_SOCKET_DIR=.runtime/mock-socket
mkdir -p "$ROBOZIUM_HOST_HUB_DIR/readonly/safe-scripts" \
  "$ROBOZIUM_HOST_LOG_DIR" "$ROBOZIUM_HOST_SOCKET_DIR" \
  local .runtime/local-deps

if ! printenv ROBOZIUM_API_USER >/dev/null; then
  docker_security_options=$(docker info --format '{{json .SecurityOptions}}')
  case "$docker_security_options" in
    *rootless*) export ROBOZIUM_API_USER=0:0 ;;
    *) export ROBOZIUM_API_USER="$(id -u):$(id -g)" ;;
  esac
fi

"$@" up --build --exit-code-from api &
compose_pid=$!
compose_exit_status=0
wait "$compose_pid" || compose_exit_status=$?
compose_pid=
exit "$compose_exit_status"
