"""Check the application naming boundary and preserved license."""
import subprocess
from pathlib import Path

root = Path(__file__).resolve().parents[1]
paths = subprocess.check_output(["git", "-C", str(root), "ls-files", "--cached", "--others", "--exclude-standard", "-z"]).decode().split("\0")
legacy_prefix = bytes.fromhex("7065666661").decode()
violations = []
for relative in paths:
    if not relative:
        continue
    path = root / relative
    if legacy_prefix in relative.casefold():
        violations.append(relative)
    try:
        content = path.read_text()
    except (UnicodeError, IsADirectoryError):
        continue
    if legacy_prefix in content.casefold():
        violations.append(relative)
assert not violations, f"Legacy application names found: {violations}"
original_license = subprocess.check_output(["git", "-C", str(root), "show", "HEAD:LICENSE"])
assert (root / "LICENSE").read_bytes() == original_license
print(f"Naming and preserved-license checks passed ({len(paths) - 1} candidate files)")
