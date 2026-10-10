#!/bin/sh
# Host owner of configuration commits and Compose lifecycle. No host Python needed.
set -eu
cd "$(dirname "$0")/.."
umask 077
export ROBOZIUM_MODE=$1
export ROBOZIUM_LAUNCHER_WEB_PORT="${ROBOZIUM_WEB_PORT:-}"
mkdir -p .runtime/env-control
control=.runtime/env-control
launch_lock=.runtime/launch.lock
if ! mkdir "$launch_lock" 2>/dev/null; then
  echo "Already running: $launch_lock" >&2
  exit 1
fi
supervisor_pid=
compose_pid=
started=
cleanup() {
  if [ -n "$compose_pid" ]; then
    kill -TERM "$compose_pid" 2>/dev/null || :
    wait "$compose_pid" 2>/dev/null || :
  fi
  if [ -n "$supervisor_pid" ]; then
    kill -TERM "$supervisor_pid" 2>/dev/null || :
    wait "$supervisor_pid" 2>/dev/null || :
  fi
  if [ -n "$started" ]; then compose stop >/dev/null 2>&1 || :; fi
  rmdir "$launch_lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

compose_files() {
  env_source=$1
  shift
  if [ -f .env ]; then set -- --env-file .env "$@"; fi
  if [ -f "$env_source" ]; then set -- --env-file "$env_source" "$@"; fi
  docker compose "$@"
}
compose() {
  compose_files .env.encrypt -f compose.yaml -f .runtime/capability-mounts.yaml "$@"
}
run_compose() {
  set -- -f compose.yaml -f .runtime/capability-mounts.yaml "$@"
  if [ -f .env ]; then set -- --env-file .env "$@"; fi
  if [ -f .env.encrypt ]; then set -- --env-file .env.encrypt "$@"; fi
  docker compose "$@" &
  compose_pid=$!
  result=0
  wait "$compose_pid" || result=$?
  compose_pid=
  return "$result"
}
status() {
  printf '%s\n' "$1" > "$control/status.next"
  mv "$control/status.next" "$control/status"
}
load_environment() {
  compose_environment=$(compose_files "$1" -f compose.yaml config --environment) || return 1
  # Dotenv single quotes retain escaped backslashes in Compose; the editor's
  # literal serializer follows python-dotenv. Restore them for host paths too.
  hub_root=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_HUB_ROOT=//p' | sed 's/\\\\/\\/g')
  local_dirs=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_LOCAL_DIRS=//p' | sed 's/\\\\/\\/g')
  if [ "${ROBOZIUM_HUB_ROOT+x}" ]; then hub_root=$ROBOZIUM_HUB_ROOT; fi
  if [ "${ROBOZIUM_LOCAL_DIRS+x}" ]; then local_dirs=$ROBOZIUM_LOCAL_DIRS; fi
  api_user=$(printf '%s\n' "$compose_environment" | sed -n 's/^ROBOZIUM_API_USER=//p')
  if [ -n "$api_user" ]; then export ROBOZIUM_API_USER="$api_user"; fi
  unset compose_environment
  if [ "$ROBOZIUM_MODE" = mock ]; then
    export ROBOZIUM_HOST_HUB_DIR=.runtime/mock-hub
    export ROBOZIUM_HOST_LOG_DIR=.runtime/mock-logs
    export ROBOZIUM_HOST_SOCKET_DIR=.runtime/mock-socket
  else
    export ROBOZIUM_HOST_HUB_DIR="${hub_root:-../Robozium-Hub}"
    export ROBOZIUM_HOST_LOG_DIR=.runtime/logs
    export ROBOZIUM_HOST_SOCKET_DIR=.runtime/host-socket
  fi
}
create_directories() {
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
  if [ -n "$supervisor_pid" ]; then
    kill -TERM "$supervisor_pid" 2>/dev/null || :
    wait "$supervisor_pid" 2>/dev/null || :
    supervisor_pid=
  fi
  if [ "$ROBOZIUM_MODE" != live ] || ! command -v process-compose >/dev/null 2>&1; then return; fi
  process-compose -f process-compose.yaml --disable-dotenv --no-server -t=false \
    --namespace "live-$(uname -s)" up > "$ROBOZIUM_HOST_LOG_DIR/host-services.log" 2>&1 &
  supervisor_pid=$!
}
apply_request() {
  rm -f "$control/request"
  if [ -f .env.encrypt ]; then
    if ! cmp -s .env.encrypt "$control/expected"; then status failed_conflict; return; fi
  elif [ -s "$control/expected" ]; then status failed_conflict; return
  fi
  status applying
  if ! load_environment "$control/candidate" 2>/dev/null || \
     ! write_capability_mounts "$local_dirs" > "$control/mounts.next" 2>/dev/null || \
     ! create_directories 2>/dev/null; then
    status failed_configuration
    load_environment .env.encrypt
    return
  fi
  cp .runtime/capability-mounts.yaml "$control/mounts.previous"
  cp "$control/candidate" .env.encrypt.next
  chmod 600 .env.encrypt.next
  mv .env.encrypt.next .env.encrypt
  mv "$control/mounts.next" .runtime/capability-mounts.yaml
  unset ROBOZIUM_BOOT_ERROR
  start_host_processes
  if run_compose up --no-build --force-recreate --wait --wait-timeout 180 api web; then
    status applied
  else
    cp "$control/expected" .env.encrypt.next
    mv .env.encrypt.next .env.encrypt
    cp "$control/mounts.previous" .runtime/capability-mounts.yaml
    load_environment .env.encrypt
    start_host_processes
    run_compose up --no-build --wait --wait-timeout 180 api web || :
    status failed_restart
  fi
}

load_environment .env.encrypt
create_directories
if ! write_capability_mounts "$local_dirs" > .runtime/capability-mounts.yaml; then
  export ROBOZIUM_BOOT_ERROR='A catalogue folder is unavailable. Correct it in Environment and apply again.'
  write_capability_mounts '' > .runtime/capability-mounts.yaml
fi
configure_api_user
start_host_processes
status idle
started=yes
run_compose up --build --wait --wait-timeout 180 api web
missing=0
while :; do
  if [ -n "$(compose ps --status running -q api)" ]; then missing=0
  else
    # Allow a short external restart without shutting down the whole project.
    [ -n "$(compose ps --all -q api)" ] || break
    missing=$((missing + 1))
    [ "$missing" -lt 5 ] || break
    sleep 1
    continue
  fi
  if [ -f "$control/request" ]; then
    if [ "$(cat "$control/request")" = apply ]; then apply_request
    else rm -f "$control/request"; status failed_request
    fi
  fi
  sleep 1
done
