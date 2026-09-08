"""Stage isolated constants using the checked-in deployment choices."""

from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / "hub.config.py"


def write_config(
    root: Path, *, workspace="workspace", name="TestHub", interval_s=60.0
) -> Path:
    path = root / "hub.config.py"
    path.write_text(
        "from dataclasses import replace\n"
        + CONFIG.read_text()
        + f"\nNAME = {name!r}\n"
        + f"WORKSPACE = replace(WORKSPACE, root=Path({workspace!r}))\n"
        + "LOGGING = replace(LOGGING, path=Path('technical_logs/backend.jsonl'))\n"
        + f"DEPENDENCY_HEALTH = replace(DEPENDENCY_HEALTH, interval_s={interval_s!r})\n"
    )
    return path
