#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
WEB_DIR="${REPO_ROOT}/web"
API_URL="http://127.0.0.1:8000"

source "${REPO_ROOT}/scripts/env.sh"
cd "${REPO_ROOT}"
APP_TARGET="robosprawl.api.app:mock_app"
ENV_ARGS=()
case "${1:-}" in
    "") ;;
    --live) APP_TARGET="robosprawl.api.live:app"
        if [[ -f "${ENV_FILE}" ]]; then ENV_ARGS=(--env-file "${ENV_FILE}"); fi ;;
    *) echo "Usage: $0 [--live]" >&2; exit 2 ;;
esac

for command in curl uv npm setsid; do
	if ! command -v "${command}" >/dev/null 2>&1; then
		echo "Required command is not installed: ${command}" >&2
		exit 1
	fi
done

backend_pid=""
frontend_pid=""

stop_process_group() {
	local pid="$1"
	if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
		kill -- -"${pid}" 2>/dev/null || kill "${pid}" 2>/dev/null || true
		wait "${pid}" 2>/dev/null || true
	fi
}

cleanup() {
	trap - EXIT INT TERM
	stop_process_group "${frontend_pid}"
	stop_process_group "${backend_pid}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

wait_for_backend() {
	local deadline=$((SECONDS + 60))
	while (( SECONDS < deadline )) && kill -0 "${backend_pid}" 2>/dev/null; do
		if curl --silent --fail "${API_URL}/ready" >/dev/null 2>&1; then
			return 0
		fi
		sleep 1
	done
	echo "Backend did not become ready within 60 seconds." >&2
	return 1
}

echo "Starting backend at ${API_URL}..."
setsid uv run \
	--project "${REPO_ROOT}" \
	"${ENV_ARGS[@]}" \
	fastapi dev --entrypoint "${APP_TARGET}" \
	--reload-dir "${REPO_ROOT}/src" --host 127.0.0.1 --port 8000 &
backend_pid=$!

echo "Waiting for backend readiness..."
wait_for_backend

echo "Starting frontend at http://127.0.0.1:3000..."
setsid uv run \
	--project "${REPO_ROOT}" \
	"${ENV_ARGS[@]}" \
	env ROBOSPRAWL_API_BASE_URL="${API_URL}" \
	npm --prefix "${WEB_DIR}" run dev &
frontend_pid=$!

echo "RoboSprawl is starting. Press Ctrl+C to stop both services."

set +e
wait -n "${backend_pid}" "${frontend_pid}"
exit_status=$?
set -e

if kill -0 "${backend_pid}" 2>/dev/null; then
	echo "Frontend stopped; shutting down the backend." >&2
else
	echo "Backend stopped; shutting down the frontend." >&2
fi

exit "${exit_status}"
