#!/bin/sh
# Launch the live application with optional host processes.
set -eu

cleanup() {
  for pid in "$compose_pid" "$supervisor_pid"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || :
      wait "$pid" 2>/dev/null || :
    fi
  done
  rmdir "$launch_lock"
}

acquire_launch_lock() {
  launch_lock=.runtime/launch.lock
  mkdir -p .runtime
  if ! mkdir "$launch_lock" 2>/dev/null; then
    echo "Already running: $launch_lock" >&2
    exit 1
  fi
  compose_pid=
  supervisor_pid=
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

load_live_environment() {
  export ROBOZIUM_MODE=live
  compose_environment=$("$@" config --environment)
  hub_root=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_HUB_ROOT=//p')
  api_user=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_API_USER=//p')
  unset compose_environment
  if [ -n "$api_user" ]; then export ROBOZIUM_API_USER="$api_user"; fi
  export ROBOZIUM_HOST_HUB_DIR="${hub_root:-../Robozium-Hub}"
  export ROBOZIUM_HOST_LOG_DIR=.runtime/logs
  export ROBOZIUM_HOST_SOCKET_DIR=.runtime/host-socket
}

create_runtime_directories() {
  mkdir -p "$ROBOZIUM_HOST_HUB_DIR/readonly/safe-scripts" \
    "$ROBOZIUM_HOST_LOG_DIR" "$ROBOZIUM_HOST_SOCKET_DIR" \
    local/tools local/skills .runtime/local-deps
}

configure_api_user() {
  if printenv ROBOZIUM_API_USER >/dev/null; then return; fi
  docker_security_options=$(docker info --format '{{json .SecurityOptions}}')
  case "$docker_security_options" in
    *rootless*) export ROBOZIUM_API_USER=0:0 ;;
    *) export ROBOZIUM_API_USER="$(id -u):$(id -g)" ;;
  esac
}

start_host_processes() {
  if ! command -v process-compose >/dev/null 2>&1; then return; fi
  process_namespace="live-$(uname -s)"
  process-compose -f process-compose.yaml \
    --disable-dotenv --no-server -t=false --namespace "$process_namespace" up \
    > "$ROBOZIUM_HOST_LOG_DIR/host-services.log" 2>&1 &
  supervisor_pid=$!
}

run_application() {
  "$@" up --build --exit-code-from api &
  compose_pid=$!
  compose_exit_status=0
  wait "$compose_pid" || compose_exit_status=$?
  compose_pid=
  return "$compose_exit_status"
}

main() {
  cd "$(dirname "$0")/.."
  umask 077
  acquire_launch_lock

  set -- docker compose
  if [ -f .env.encrypt ]; then set -- "$@" --env-file .env.encrypt; fi
  if [ -f .env ]; then set -- "$@" --env-file .env; fi
  set -- "$@" -f compose.yaml

  load_live_environment "$@"
  create_runtime_directories
  configure_api_user
  start_host_processes
  run_application "$@"
}

main
