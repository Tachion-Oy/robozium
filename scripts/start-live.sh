#!/bin/sh
# Launch the live application with optional host processes.
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
supervisor_pid=
cleanup() {
  for pid in "$compose_pid" "$supervisor_pid"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || :
      wait "$pid" 2>/dev/null || :
    fi
  done
  rmdir "$launch_lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

export ROBOZIUM_MODE=live
# Compose owns dotenv parsing and environment precedence.
compose_environment=$("$@" config --environment)
hub_root=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_HUB_ROOT=//p')
api_user=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_API_USER=//p')
unset compose_environment
if [ -n "$api_user" ]; then export ROBOZIUM_API_USER="$api_user"; fi
export ROBOZIUM_HOST_HUB_DIR="${hub_root:-../Robozium-Hub}"
export ROBOZIUM_HOST_LOG_DIR=.runtime/logs
export ROBOZIUM_HOST_SOCKET_DIR=.runtime/host-socket
# Docker needs these bind-mount sources before starting the container.
# Python initializes the application directories inside the mounted hub.
mkdir -p "$ROBOZIUM_HOST_HUB_DIR/readonly/safe-scripts" \
  "$ROBOZIUM_HOST_LOG_DIR" "$ROBOZIUM_HOST_SOCKET_DIR" \
  local/tools local/skills .runtime/local-deps

if ! printenv ROBOZIUM_API_USER >/dev/null; then
  docker_security_options=$(docker info --format '{{json .SecurityOptions}}')
  case "$docker_security_options" in
    *rootless*) export ROBOZIUM_API_USER=0:0 ;;
    *) export ROBOZIUM_API_USER="$(id -u):$(id -g)" ;;
  esac
fi

if command -v process-compose >/dev/null 2>&1; then
  process_namespace="live-$(uname -s)"
  process-compose -f process-compose.yaml \
    --disable-dotenv --no-server -t=false --namespace "$process_namespace" up \
    > "$ROBOZIUM_HOST_LOG_DIR/host-services.log" 2>&1 &
  supervisor_pid=$!
fi

"$@" up --build --exit-code-from api &
compose_pid=$!
compose_exit_status=0
wait "$compose_pid" || compose_exit_status=$?
compose_pid=
exit "$compose_exit_status"
