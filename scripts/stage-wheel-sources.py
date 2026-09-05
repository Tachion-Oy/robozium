"""Copy build inputs into local staging; external dependencies remain read-only."""

import shutil
import tomllib
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sources = tomllib.loads((root / "pyproject.toml").read_text())["tool"]["uv"]["sources"]
staging = root / ".artifacts" / "wheel-sources"
for name, source in (
    ("core", root / sources["roboz"]["path"]),
    ("shed", root / sources["roboz-shed"]["path"]),
    ("openai", root / sources["roboz-openai"]["path"]),
    ("application", root),
):
    target = staging / name
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    for filename in ("pyproject.toml", "README.md", "LICENSE"):
        shutil.copyfile(source / filename, target / filename)
    shutil.copytree(
        source / "src",
        target / "src",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
