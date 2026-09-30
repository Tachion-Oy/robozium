#!/bin/sh
# Launch the application independently of optional host processes.
set -eu
mode=$1
user_variable=$2
base=$3
encrypted=$4
plain=$5
lock=$6
shift 6
umask 077
mkdir -p "$(dirname "$lock")"
if ! mkdir "$lock" 2>/dev/null; then echo "Already running: $lock" >&2; exit 1; fi
child=
supervisor=
cleanup() {
  trap - EXIT INT TERM
  for pid in "$child" "$supervisor"; do
    if [ -n "$pid" ]; then
      kill -TERM "$pid" 2>/dev/null || :
      wait "$pid" 2>/dev/null || :
    fi
  done
  rmdir "$lock"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Called in a subshell so its PID becomes Docker's PID for signal forwarding.
compose() {
  set -- -f "$base" "$@"
  if [ -f "$plain" ]; then set -- --env-file "$plain" "$@"; fi
  if [ -f "$encrypted" ]; then set -- --env-file "$encrypted" "$@"; fi
  exec docker compose "$@"
}
export ROBOZIUM_MODE="$mode"
if [ "$mode" = live ]; then
  # Let Compose resolve dotenv quoting and precedence; never evaluate shell code.
  settings=$(compose config --environment)
  hub=$(printf '%s\n' "$settings" | sed -n 's/^ROBOZIUM_HUB_ROOT=//p')
  api_user=$(printf '%s\n' "$settings" | sed -n "s/^$user_variable=//p")
  unset settings
  if [ -n "$api_user" ]; then export "$user_variable=$api_user"; fi
  export ROBOZIUM_HOST_HUB_DIR="${hub:-../Robozium-Hub}"
  export ROBOZIUM_HOST_LOG_DIR=.runtime/logs
  export ROBOZIUM_HOST_SOCKET_DIR=.runtime/host-socket
else
  export ROBOZIUM_HOST_HUB_DIR=.runtime/mock-hub
  export ROBOZIUM_HOST_LOG_DIR=.runtime/mock-logs
  export ROBOZIUM_HOST_SOCKET_DIR=.runtime/mock-socket
fi
mkdir -p "$ROBOZIUM_HOST_HUB_DIR/readonly/safe-scripts" "$ROBOZIUM_HOST_LOG_DIR" "$ROBOZIUM_HOST_SOCKET_DIR" local .runtime/local-deps
if ! printenv "$user_variable" >/dev/null; then
  security=$(docker info --format '{{json .SecurityOptions}}')
  case "$security" in
    *rootless*) export "$user_variable=0:0" ;;
    *) export "$user_variable=$(id -u):$(id -g)" ;;
  esac
fi
if [ "$mode" = live ] && command -v process-compose >/dev/null 2>&1; then
  process-compose -f process-compose.yaml --disable-dotenv --no-server -t=false -n "live-$(uname -s)" up > "$ROBOZIUM_HOST_LOG_DIR/host-services.log" 2>&1 &
  supervisor=$!
fi
compose "$@" &
child=$!
status=0
wait "$child" || status=$?
child=
exit "$status"
