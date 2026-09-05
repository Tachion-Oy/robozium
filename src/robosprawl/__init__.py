"""RoboSprawl application; temporary files are confined to its runtime root."""
import os
import tempfile
from pathlib import Path

REPO_ROOT = Path(os.environ.get("ROBOSPRAWL_ROOT", Path(__file__).resolve().parents[2])).resolve()
TEMP_ROOT = REPO_ROOT / ".artifacts" / "tmp"
TEMP_ROOT.mkdir(parents=True, exist_ok=True)
tempfile.tempdir = str(TEMP_ROOT)
