"""Stage isolated constants using the checked-in deployment choices."""

from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / "hub.config.py"


def write_config(
    root: Path, *, sandbox_root="sandbox", name="TestHub", interval_s=60.0
) -> Path:
    path = root / "hub.config.py"
    path.write_text(
        "from dataclasses import replace\n"
        "from pathlib import Path\n"
        + CONFIG.read_text()
        + f"\nNAME = {name!r}\n"
        + f"SANDBOX = replace(SANDBOX, root=Path({sandbox_root!r}))\n"
        + "LOGGING = replace(LOGGING, path=Path('technical_logs/backend.jsonl'))\n"
        + f"DEPENDENCY_HEALTH = replace(DEPENDENCY_HEALTH, interval_s={interval_s!r})\n"
    )
    return path
