"""Verify recoverable deletion through the CLI installed in the API image."""

import os
from pathlib import Path
from tempfile import TemporaryDirectory

from roboz import Agent
from roboz.llm import MockLLMEndpoint
from roboz.models import Stop
from roboz.shed.models import ActionVerdict
from roboz.shed.skills import cli_skill
from roboz.shed.tools.cli_commands import get_run_file_command
from roboz.tools import stop


def main() -> None:
    """Use isolated files and trash storage without contacting any providers."""
    with TemporaryDirectory(prefix="robozium-cli-") as directory:
        root = Path(directory)
        os.environ["XDG_DATA_HOME"] = str(root / "data")
        note = root / "note.txt"
        content = "Recoverable container CLI deletion.\n"
        note.write_text(content, encoding="utf-8")
        agent = Agent(
            name="container_cli",
            system_prompt="Trash the temporary note and stop.",
            tools=[
                *get_run_file_command(base=root, default_verdict=ActionVerdict.allow),
                stop,
            ],
            auto_loaded_skills=[cli_skill],
            event_sinks=[],
            agent_endpoint=MockLLMEndpoint(
                [
                    {
                        "action": "run_file_command",
                        "rationale": "verify native recoverable deletion",
                        "value": [["gio", "CMD"], ["trash", "ARG"], [str(note), "PTH"]],
                    },
                    {"action": "stop", "rationale": "finished", "value": "done"},
                ]
            ),
        )
        result, _ = agent.invoke()
        assert isinstance(result, Stop) and result.value == "done"
        assert not note.exists(), "gio trash did not remove the source file"
        trashed = root / "data/Trash/files/note.txt"
        assert trashed.read_text(encoding="utf-8") == content
    print("Guarded gio trash preserves the deleted file.")


if __name__ == "__main__":
    main()
