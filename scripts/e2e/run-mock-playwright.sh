#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
source "${REPO_ROOT}/scripts/env.sh"
E2E_API_PORT="${ROBOSPRAWL_E2E_API_PORT:-8000}"
API_URL="http://127.0.0.1:${E2E_API_PORT}"
E2E_WEB_PORT="${ROBOSPRAWL_E2E_WEB_PORT:-3100}"
E2E_WEB_URL="http://127.0.0.1:${E2E_WEB_PORT}"
API_LOG_PATH="${ROBOSPRAWL_API_LOG_PATH:-${REPO_ROOT}/.artifacts/mock-api.log}"
API_READY_TIMEOUT_SECONDS="${ROBOSPRAWL_API_READY_TIMEOUT_SECONDS:-60}"
PLAYWRIGHT_ARGS=("$@")

has_project_arg() {
	for arg in "${PLAYWRIGHT_ARGS[@]}"; do
		case "${arg}" in
			--project | --project=*) return 0 ;;
		esac
	done
	return 1
}

if [[ "${ROBOSPRAWL_E2E_SINGLE_BROWSER:-0}" != "1" ]] &&
	! has_project_arg; then
	ALL_BROWSERS_STATUS=0
	for project in chromium firefox webkit; do
		echo "Running ${project} e2e tests in an isolated mock backend..."
		if ! ROBOSPRAWL_E2E_SINGLE_BROWSER=1 bash "${SCRIPT_DIR}/run-mock-playwright.sh" \
			"${PLAYWRIGHT_ARGS[@]}" \
			--project="${project}"; then
			ALL_BROWSERS_STATUS=1
		fi
	done
	exit "${ALL_BROWSERS_STATUS}"
fi

E2E_WORKSPACE="$(mktemp -d "${TMPDIR}/robosprawl-e2e-XXXXXX")"
E2E_HUB_BASE_DIR="${E2E_WORKSPACE}/hub_data"
# Seed a project that the web client can pick for run start.
E2E_PROJECT_SLUG="e2e-project"
E2E_PROJECT_DIR="${E2E_HUB_BASE_DIR}/projects/${E2E_PROJECT_SLUG}"
# Folder names must match the hub config below (the single source of truth); the
# backend derives project.snapshots / project.memory from those config names.
E2E_CONVERSATION_LOGS_DIR="${E2E_PROJECT_DIR}/conversation_logs"
E2E_SNAPSHOT_DIR="${E2E_PROJECT_DIR}/conversation_snapshots"
E2E_MEMORY_DIR="${E2E_PROJECT_DIR}/persistent_memory"
E2E_SEED_CONVERSATION_ID="seed-conversation"
API_PID=""

cleanup() {
	if [[ -n "${API_PID}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
		echo "Stopping mock FastAPI backend..."
		kill -- -"${API_PID}" 2>/dev/null || kill "${API_PID}" 2>/dev/null || true
		wait "${API_PID}" 2>/dev/null || true
	fi
	rm -rf -- "${E2E_WORKSPACE}"
}
trap cleanup EXIT INT TERM

cd "${REPO_ROOT}"

if curl --silent --fail "${API_URL}/live" >/dev/null 2>&1; then
	echo "Mock API port is already in use at ${API_URL}."
	echo "Set ROBOSPRAWL_E2E_API_PORT to a free port and retry."
	exit 1
fi

if curl --silent --fail "${E2E_WEB_URL}" >/dev/null 2>&1; then
	echo "E2E web port is already in use at ${E2E_WEB_URL}."
	echo "Set ROBOSPRAWL_E2E_WEB_PORT to a free port and retry."
	exit 1
fi

export PLAYWRIGHT_HTML_OPEN="${PLAYWRIGHT_HTML_OPEN:-never}"
export ROBOSPRAWL_E2E_ALL_BROWSERS=1
export ROBOSPRAWL_E2E_WEB_PORT="${E2E_WEB_PORT}"

cat > "${E2E_WORKSPACE}/hub.config.json" <<EOF
{
  "hub": {
    "name": "RoboSprawlE2E"
  },
  "logging": {
    "console": {"level": "INFO"},
    "file": {
      "path": "technical_logs/backend.jsonl",
      "level": "DEBUG",
      "max_bytes": 26214400,
      "backup_count": 5,
      "on_error": "fail"
    }
  },
  "sandbox": {
    "root": "hub_data",
    "readonly": "readonly",
    "workspace": "workspace",
    "projects": "projects",
    "safe_scripts": "safe-scripts"
  },
  "project": {
    "logs": "conversation_logs",
    "snapshots": "conversation_snapshots",
    "memory": "persistent_memory"
  }
}
EOF

mkdir -p "${E2E_CONVERSATION_LOGS_DIR}" "${E2E_SNAPSHOT_DIR}" "${E2E_MEMORY_DIR}"
export ROBOSPRAWL_E2E_CONVERSATION_LOGS_DIR="${E2E_CONVERSATION_LOGS_DIR}"
export ROBOSPRAWL_E2E_SNAPSHOT_DIR="${E2E_SNAPSHOT_DIR}"
export ROBOSPRAWL_E2E_MEMORY_DIR="${E2E_MEMORY_DIR}"
export ROBOSPRAWL_E2E_HUB_BASE_DIR="${E2E_HUB_BASE_DIR}"
export ROBOSPRAWL_E2E_PROJECT_SLUG="${E2E_PROJECT_SLUG}"
export ROBOSPRAWL_E2E_SEED_CONVERSATION_ID="${E2E_SEED_CONVERSATION_ID}"
export ROBOSPRAWL_E2E_OLDEST_SEED_PATH="${E2E_CONVERSATION_LOGS_DIR}/seed-001.json"
export ROBOSPRAWL_API_BASE_URL="${API_URL}"

uv run --project "${REPO_ROOT}" python - <<'PY'
import os
from datetime import datetime, timezone
from pathlib import Path

from roboz.models import Message
from roboz.runtime.persistence.schema import ConversationRun, message_to_logged_row
from roboz.models.truncation import DEFAULT
from roboz.models import Role

conversation_root = Path(os.environ["ROBOSPRAWL_E2E_CONVERSATION_LOGS_DIR"])
seed_conversation_id = os.environ["ROBOSPRAWL_E2E_SEED_CONVERSATION_ID"]

# DEFAULT (not NO_MESSAGE) keeps the message in context: NO_MESSAGE removes it,
# leaving the conversation with zero in-context tokens, which the librarian
# treats as nothing to snapshot — so the seed would only ever get purged.
seed_message = message_to_logged_row(
    Message(
        role=Role.USER,
        content="seeded librarian snapshot trigger",
        truncation=DEFAULT,
        token_input=3,
        token_output=0,
    ),
    message_id="msg-1",
    sequence=1,
    created_at=datetime(2026, 1, 1, 0, 0, 1, tzinfo=timezone.utc),
)
valid_run = ConversationRun(
    conversation_id=seed_conversation_id,
    agent_name="orchestrator",
    started_at=datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
    status="completed",
    messages=[seed_message],
)
stale_librarian_run = ConversationRun(
    conversation_id="stale-preboot-librarian",
    agent_name="librarian",
    started_at=datetime(2026, 1, 1, tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
    status="running",
    messages=[],
)

for index in range(1, 6):
    path = conversation_root / f"seed-{index:03d}.json"
    if index == 1:
        path.write_text(valid_run.model_dump_json(), encoding="utf-8")
    else:
        path.write_text("{}", encoding="utf-8")
    ts = 1_700_000_000 + index
    os.utime(path, (ts, ts))

stale_path = conversation_root / "librarian" / "stale-preboot-librarian.json"
stale_path.parent.mkdir(parents=True, exist_ok=True)
stale_path.write_text(stale_librarian_run.model_dump_json(), encoding="utf-8")
os.utime(stale_path, (1_700_000_000, 1_700_000_000))
PY

echo "Starting mock FastAPI backend..."
setsid bash -c \
	'cd "$1" && exec uv run --project "$2" fastapi run "$2/src/robosprawl/api/app.py" --app mock_app --port "$3"' \
	bash "${E2E_WORKSPACE}" "${REPO_ROOT}" "${E2E_API_PORT}" > "${API_LOG_PATH}" 2>&1 &
API_PID=$!

echo "Waiting for mock API at ${API_URL} (timeout: ${API_READY_TIMEOUT_SECONDS}s)..."
for ((i=1; i<=API_READY_TIMEOUT_SECONDS; i++)); do
	if ! kill -0 "${API_PID}" 2>/dev/null; then
		echo "Mock API process exited before becoming ready."
		echo "Backend log (${API_LOG_PATH}):"
		cat "${API_LOG_PATH}"
		exit 1
	fi

	if curl --silent --fail "${API_URL}/ready" >/dev/null 2>&1; then
		echo "Mock API is ready."
		cd "${REPO_ROOT}/web"
		if ((${#PLAYWRIGHT_ARGS[@]} > 0)); then
			echo "Running Playwright with args: ${PLAYWRIGHT_ARGS[*]}"
			npm run test:e2e:playwright -- "${PLAYWRIGHT_ARGS[@]}"
		else
			npm run test:e2e:playwright
		fi
		exit 0
	fi

	sleep 1
done

echo "Mock API did not become ready in time."
echo "Backend log (${API_LOG_PATH}):"
cat "${API_LOG_PATH}"
exit 1
