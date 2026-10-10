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
# Docker needs these bind-mount sources before starting the container.
# Python initializes the application directories inside the mounted hub.
mkdir -p "$ROBOZIUM_HOST_HUB_DIR/readonly/safe-scripts" \
  "$ROBOZIUM_HOST_LOG_DIR" "$ROBOZIUM_HOST_SOCKET_DIR" \
  local/tools local/skills .runtime/local-deps
compose_environment=$("$@" config --environment)
local_dirs=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_LOCAL_DIRS=//p')
unset compose_environment
{
  directories=$local_dirs
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
} > .runtime/capability-mounts.yaml
set -- "$@" -f .runtime/capability-mounts.yaml

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
