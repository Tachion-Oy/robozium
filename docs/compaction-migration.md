# Shared compaction migration

RoboSprawl uses `roboz_shed.tools.get_compactify_messages_when_needed_tool` from
Roboz commit `4e531215c69aec42e82af24e47f06c871b896f82`. The redundant application
module and identifier are removed. Python consumers should import the builder
from `roboz_shed.tools` and its name from `roboz_shed.identifiers`.

The tool keeps RoboSprawl's `compactify_messages_when_needed` caller name,
60% application threshold (80% standalone), bootstrap preservation, status
payload, and per-instance counter. Both full prompts match the working local
PeffaHub/PeffaShed implementation exactly. Roboz core's existing summarizer
continues to serve compaction, snapshots, and persistent memory.

The application passes its owning event pipe. Cancellation, interruption,
provider failure, and timeout preserve the original history and counter.
`OrchestratorConstructor.compactify_timeout_s` is an optional keyword-only
setting, defaulting to `None`; a configured value must be positive and finite.
Timeouts bound each provider attempt. The runtime stops waiting and ignores late
results without forcibly terminating provider workers. Summarization messages
and model-call events follow the supplied pipe.

## Local validation — 2026-09-05

Commands ran in the existing Roboz checkout and the isolated RoboSprawl worktree.
Generated reports and environments stayed outside tracked source files.

### Roboz

| Command | Result |
| --- | --- |
| `uv sync --locked --dev` | Passed |
| `uv run pytest packages/shed/tests/test_compactify_messages.py packages/shed/tests/test_compaction_runtime.py --no-cov -q` | 32 passed |
| `uv run pytest --cov=roboz_shed --cov=roboz_openai --cov=roboz_proton_bridge --cov-report=json:/tmp/shared-compaction-coverage.json --junitxml=/tmp/shared-compaction-roboz-pytest.xml` | 802 passed on Python 3.13.3 |
| `uv run python scripts/check_coverage.py /tmp/shared-compaction-coverage.json` | All floors passed: core 95.47%, Shed 90.86%, OpenAI 90.00%, Proton Bridge 89.72% |
| `uv run python examples/quickstart.py` | Passed |
| `uv run ruff check` | Passed |
| `uv run pyright` | No errors or warnings |
| `bash scripts/run_type_tests.sh` | All valid and expected-failure cases passed |
| `uv build --no-sources --all-packages --out-dir <fresh-dir>` | Eight candidate archives built |
| `uv run twine check <fresh-dir>/*` | All archives passed |
| `uv run python scripts/check_distributions.py --dist <fresh-dir>` | Independent wheel and rebuilt-sdist installations passed |
| `git diff --check` | Passed |

### RoboSprawl

Source `scripts/env.sh` before these commands. Python 3.13 uses the separate
`.venv-py313` environment selected through `UV_PROJECT_ENVIRONMENT`.

| Command | Result |
| --- | --- |
| `uv sync --locked --dev` | Passed with freshly installed Roboz packages |
| `uv run pytest tests/unit/test_port_composition.py --no-cov -q` | Five passed, including compaction persistence and blocked-provider cancellation/timeout |
| `uv run pytest --cov-fail-under=90` | 260 passed on Python 3.14.7 (94.06%) and Python 3.13.3 (93.95%) |
| `uv run ruff check src tests scripts` | Passed |
| `uv run pyright` | No errors or warnings |
| `uv lock --check` | Passed; dependency manifests and lockfile unchanged |
| `bash scripts/verify-wheels.sh <candidate-dir>` | Wheel and rebuilt-sdist metadata, isolated composition, and real HTTP create/stream/reply/completion/persistence passed |
| `git diff --check` | Passed |

The installed checks verify imports originate in the fresh installation rather
than a checkout. Tests use scripted providers without live credentials.
Browser suites and hosted CI were not run for this backend migration.

## Integration order

The Roboz change is on `feat/shared-compaction` in the existing checkout.
RoboSprawl is on `refactor/shared-compaction` in
`/home/tommi/Projects/robosprawl-worktrees/shared-compaction`; the existing sibling
`roboz` symlink supplies its relative source dependencies. The main application
checkout and other worktrees are untouched.

Push the Roboz feature branch before the application branch so its three CI
checkout pins can fetch the new dependency. Merge the Roboz dependency PR before
the application PR. This migration creates no tags or package releases. Hosted
CI remains the integration gate, including the existing browser checks.
Coordinate the CI pin update with the separate CI-repair branch when integrating
both changes.
