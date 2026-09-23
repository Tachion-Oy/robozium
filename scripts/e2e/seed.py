"""Seed deterministic Librarian input in the runner-owned workspace."""

import os
from datetime import datetime, timezone
from pathlib import Path

from roboz.models import Message, Role
from roboz.models.truncation import DEFAULT
from roboz.runtime.persistence.schema import ConversationRun, message_to_logged_row

conversation_root = Path(os.environ["ROBOZIUM_E2E_CONVERSATION_LOGS_DIR"])
seed_conversation_id = os.environ["ROBOZIUM_E2E_SEED_CONVERSATION_ID"]

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
    started_at=datetime(2026, 1, 1, tzinfo=timezone.utc)
    .isoformat()
    .replace("+00:00", "Z"),
    status="completed",
    messages=[seed_message],
)
stale_librarian_run = ConversationRun(
    conversation_id="stale-preboot-librarian",
    agent_name="librarian",
    started_at=datetime(2026, 1, 1, tzinfo=timezone.utc)
    .isoformat()
    .replace("+00:00", "Z"),
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
