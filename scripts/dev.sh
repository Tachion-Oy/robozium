#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="${REPO_ROOT}/web"
cd "${REPO_ROOT}"

case "${1:-}" in
    --mock) mode=mock ;;
    "") mode=live ;;
    *) echo "Usage: ./scripts/dev.sh [--mock]" >&2; exit 2 ;;
esac

for command in curl npm setsid uv; do
    if ! command -v "${command}" >/dev/null 2>&1; then
        echo "Required command is not installed: ${command}" >&2
        exit 1
    fi
done

api_port="${ROBOZIUM_DEV_API_PORT:-8000}"
web_port="${ROBOZIUM_DEV_WEB_PORT:-3000}"
for port in "${api_port}" "${web_port}"; do
    if [[ ! "${port}" =~ ^[1-9][0-9]{0,4}$ ]] || (( port > 65535 )); then
        echo "Development ports must be numbers from 1 to 65535." >&2
        exit 2
    fi
done

api_url="http://127.0.0.1:${api_port}"
web_url="http://127.0.0.1:${web_port}"
env_file_args=()
if [[ "${mode}" == live ]]; then
    if [[ -f .env ]]; then
        env_file_args=(--env-file "${REPO_ROOT}/.env")
    elif [[ ! -f "${ROBOZIUM_ENCRYPTED_ENV_PATH:-${REPO_ROOT}/.env.encrypt}" ]]; then
        echo "Live mode needs .env or .env.encrypt. Use --mock for credential-free development." >&2
        exit 1
    fi
fi

if [[ ! -x "${WEB_DIR}/node_modules/.bin/next" ]]; then
    echo "Installing web dependencies from package-lock.json..."
    npm --prefix "${WEB_DIR}" ci
fi

mkdir -p local/tools local/skills

api_pid=""
web_pid=""

stop_process_group() {
    local pid="$1"
    if [[ -n "${pid}" ]] && kill -0 -- "-${pid}" 2>/dev/null; then
        kill -TERM -- "-${pid}" 2>/dev/null || true
    fi
    if [[ -n "${pid}" ]]; then
        wait "${pid}" 2>/dev/null || true
    fi
}

cleanup() {
    trap - EXIT INT TERM
    stop_process_group "${web_pid}"
    stop_process_group "${api_pid}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "Starting ${mode} API at ${api_url}..."
setsid env \
    ROBOZIUM_MODE="${mode}" \
    ROBOZIUM_HUB_ROOT="${ROBOZIUM_HUB_ROOT:-${REPO_ROOT}/.runtime/dev-${mode}-hub}" \
    ROBOZIUM_LOG_DIR="${ROBOZIUM_LOG_DIR:-${REPO_ROOT}/.runtime/dev-${mode}-logs}" \
    uv run --locked --project "${REPO_ROOT}" "${env_file_args[@]}" \
    uvicorn "robozium.api.app:${mode}_app" --factory --reload \
    --reload-dir "${REPO_ROOT}/src" --host 127.0.0.1 --port "${api_port}" &
api_pid=$!

echo "Waiting for API readiness..."
while kill -0 "${api_pid}" 2>/dev/null; do
    if curl --silent --fail --max-time 2 "${api_url}/ready" >/dev/null; then
        break
    fi
    sleep 1
done
if ! kill -0 "${api_pid}" 2>/dev/null; then
    echo "API exited before becoming ready." >&2
    exit 1
fi

echo "Starting web UI at ${web_url}..."
setsid env ROBOZIUM_API_BASE_URL="${api_url}" \
    npm --prefix "${WEB_DIR}" run dev -- --hostname 127.0.0.1 --port "${web_port}" &
web_pid=$!

echo "Press Ctrl+C to stop both services."
set +e
wait -n "${api_pid}" "${web_pid}"
exit_status=$?
set -e
echo "A development service stopped; shutting down both services." >&2
exit "${exit_status}"
