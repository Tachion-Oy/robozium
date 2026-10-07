#!/bin/sh
set -eu
source_dir=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
case_dir=$(mktemp -d '/tmp/robozium "mac".XXXXXX')
trap 'rm -rf "$case_dir"' EXIT INT TERM
checkout="$case_dir/checkout with spaces"
mkdir -p "$checkout/scripts" "$case_dir/bin"
cp -p "$source_dir/start" "$source_dir/process-compose.yaml" "$checkout/"
cp -p "$source_dir/scripts/start-live.sh" "$source_dir/scripts/start-mock.sh" \
  "$checkout/scripts/"
cp -R "$source_dir/examples" "$checkout/examples"
cat > "$case_dir/bin/docker" <<'DOCKER'
#!/bin/sh
if [ "$1" = info ]; then printf '[]\n'; exit 0; fi
case "$*" in *'config --environment')
  sed -n "s/^ROBOZIUM_HUB_ROOT='\(.*\)'$/ROBOZIUM_HUB_ROOT=\1/p" .env.encrypt
  exit 0;; esac
printf '%s\n' "$@" > "$TEST_DOCKER_ARGS"
printf '%s\n' "$ROBOZIUM_HOST_HUB_DIR" > "$TEST_DOCKER_ENV"
exit 0
DOCKER
chmod +x "$case_dir/bin/docker"
export PATH="$case_dir/bin:$PATH"
export TEST_DOCKER_ARGS="$case_dir/docker-args"
export TEST_DOCKER_ENV="$case_dir/docker-env"
cd "$checkout"
./start --mock
test "$(tail -n 1 "$TEST_DOCKER_ARGS")" = api
if ./start bad; then exit 1; fi
hub="$case_dir/Live Hub with \"quotes\""
printf "ROBOZIUM_HUB_ROOT='%s'\n" "$hub" > .env.encrypt
./start
test "$(tail -n 1 "$TEST_DOCKER_ARGS")" = api
test "$(cat "$TEST_DOCKER_ENV")" = "$hub"
test ! -e .runtime/host-scripts-venv
printf 'macOS launcher mock/live, validation, encrypted input, and quoted paths passed.\n'
