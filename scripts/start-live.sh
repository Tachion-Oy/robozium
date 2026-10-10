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
  local_dirs=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_LOCAL_DIRS=//p')
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

write_capability_mounts() (
  directories=$1
  case "$directories" in *'
'*) echo 'ROBOZIUM_LOCAL_DIRS must be a semicolon-separated single line' >&2; exit 1 ;; esac

  printf 'services:\n  api:\n'
  seen=";$(CDPATH= cd -- local && pwd -P);"
  container_directories=
  index=0
  while [ -n "$directories" ]; do
    case "$directories" in
      *';'*) directory=${directories%%;*}; directories=${directories#*;} ;;
      *) directory=$directories; directories= ;;
    esac
    directory=$(printf '%s' "$directory" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
    [ -n "$directory" ] || continue
    if [ ! -d "$directory" ]; then
      printf 'ROBOZIUM_LOCAL_DIRS directory does not exist: %s\n' "$directory" >&2
      exit 1
    fi
    source=$(CDPATH= cd -- "$directory" && pwd -P)
    case "$seen" in *";$source;"*) continue ;; esac
    seen="$seen$source;"
    target="/app/.runtime/capability-roots/$index"
    if [ "$index" -eq 0 ]; then printf '    volumes:\n'; fi
    escaped_source=$(printf '%s' "$source" | sed -e "s/'/''/g" -e 's/\$/$$/g')
    printf "      - type: bind\n        source: '%s'\n        target: '%s'\n        read_only: true\n        bind:\n          create_host_path: false\n" "$escaped_source" "$target"
    container_directories="${container_directories:+$container_directories;}$target"
    index=$((index + 1))
  done
  printf "    environment:\n      ROBOZIUM_LOCAL_DIRS: '%s'\n" "$container_directories"
)

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
  write_capability_mounts "$local_dirs" > .runtime/capability-mounts.yaml
  configure_api_user
  start_host_processes
  run_application "$@" -f .runtime/capability-mounts.yaml
}

main
