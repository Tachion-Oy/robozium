# Reference adaptation validation

Validated on 2026-09-07 on Linux x86_64.

- Hub base: `b68a8d1dcce31db4ad709b221a463dd635d75789`.
- Hub implementation: `864f1d4b99c838dd4c523f28191969292ec8545e`.
- Roboz base (Ctx merged): `93edea26ebbafc9d8d27e789fc0022fed8593605`.
- Roboz implementation: `662ba6b0e84d6febe8b1c099b93caabc61c7ec8c`;
  report-only follow-up `38a13ed6c1a4790e035e0d95a1b21b8c1167fb7b` is [Roboz PR #16](https://github.com/Tachion-Oy/roboz/pull/16).
- Subsequent Hub commits only record validation and do not change tested source,
  tests, package metadata, frontend assets, or candidates.
- Worktree: `/home/tommi/Projects/robosprawl-worktrees/reference-followup/robosprawl`; branch `refactor/dependency-reference`.
- Sibling `../roboz` links to the dedicated reference worktree, preserving the
  original development checkouts and the existing sibling symlink elsewhere.
- Python 3.13.3 and 3.14.7; Node 22.22.2; npm 10.9.7. Default local uv is
  0.6.14; final Python 3.14 commands use CI-pinned uv 0.12.10.
- Candidate directory: `/tmp/roboz-reference-dist-hr1gc4fl`.

## Results

The backend passes 289 tests on both Python versions, with statement coverage
94.28% (3.13) and 93.88% (3.14), exceeding the 90% floor. Ruff and Pyright pass.
The frontend passes lint, TypeScript, all 331 tests in 44 files, and production
build. Independent candidate wheel and source-archive installations pass all
five installed checks, including HTTP create/stream/reply/completion.

The actual model-selection API and active-run tests verify first → second →
first model requests through the production route and request-option wrapper,
global defaults for new runs, and isolation of another active run. The route
regression verifies one getter read per operation, deferred construction, client
reuse, live graph inspection and complete registration with zero checker calls.
Core regression tests additionally verify in-flight endpoint retention and
uncached ID/kind failures. The installed browser scenario journals calls at the
scripted provider boundary, not the UI selection label.

No production UI behavior, versions, dependency ranges, publication, health
checkers, scheduling, timeouts, or cached health responses change. The one-line
lock refresh records the already-present Roboz development PyYAML requirement.
All selectable endpoints remain in the deployment catalog. Installed Shed
exports the compaction helper after refresh; no compatibility shim is added.

## Commands and results

Run from the worktree after `source scripts/env.sh`. Logs are retained under
`.artifacts/`, which is ignored by Git. Browsers use the production frontend and
fresh installed backend outside the source import path.

| Command | Result |
| --- | --- |
| `uv sync --locked --dev --reinstall-package roboz --reinstall-package roboz-shed --reinstall-package roboz-openai` | Initially rejected stale lock; refreshed only upstream dev metadata, then passed. Repeated in isolated sibling layout to eliminate the old source import. |
| `uv run python -c 'import roboz, roboz_shed; print(roboz.__file__); print(roboz_shed.__file__)'` | Exposed existing sibling symlink to original main; after relocating the new worktree and recreating its environment, imports use intended reference candidate. |
| `uv run ruff check src tests scripts --fix` | Pass after removing obsolete unused context imports |
| `uv run ruff format src/robosprawl/mock/model_selection.py` | Pass |
| `uv run pytest --cov-fail-under=90 --cov-report=xml:.artifacts/reports/coverage.xml --junitxml=.artifacts/reports/pytest.xml` | Initial stale source caused collection errors; corrected layout revealed one obsolete `.resource` assertion (286 passed/1 failed), migrated to direct resources. Final suite: 289 passed, 94.28% coverage. |
| `uv run pytest tests/unit/test_model_selection.py tests/unit/test_api_app.py -k 'route_reads or active_model_api' --no-cov` | 2 passed |
| `uv run ruff check src tests scripts` | Pass |
| `uv run pyright` | 0 errors |
| `npm --prefix web ci` | Pass |
| `npm --prefix web run lint` | Exit 0 |
| `npm --prefix web run typecheck` | Exit 0 |
| `npm --prefix web run test:run -- --reporter=default --reporter=junit --outputFile.junit=../.artifacts/reports/vitest.xml` | Exit 0 |
| `npm --prefix web run build` | Initially failed: required API URL not set; rerun below passes |
| `npm --prefix web exec -- playwright install chromium firefox webkit` | Exit 0 |
| `uv run pytest tests/contract --no-cov` | Exit 0 |
| `bash scripts/verify-wheels.sh /tmp/roboz-reference-dist-hr1gc4fl` | Exit 0 |
| `uv run python scripts/check_distributions.py --dist /tmp/roboz-reference-dist-hr1gc4fl --python-output /home/tommi/Projects/robosprawl-worktrees/reference-followup/robosprawl/.artifacts/browser-backend` | Exit 0 |
| `ROBOSPRAWL_API_BASE_URL=http://127.0.0.1:8000 npm --prefix web run build` | Pass |
| `bash scripts/e2e/run-mock-playwright.sh --project=chromium --grep='a UI model switch'` | 1 passed; installed backend |
| `python scripts/e2e/check_runner.py` | Shell lacked `python`; rerun with `python3` passes all five cleanup cases |
| `git diff --check` | Pass |

Final Python 3.14 commands (all pass):

```bash
source scripts/env.sh
export PATH=/tmp/roboz-ci-tools/bin:$PATH
export UV_PROJECT_ENVIRONMENT=.artifacts/python3147-env
uv sync --locked --dev --python 3.14.7
uv run --python 3.14.7 --no-sync pytest --cov-fail-under=90 \
  --cov-report=xml:.artifacts/reports/coverage314.xml \
  --junitxml=.artifacts/reports/pytest314.xml
```

Earlier attempts using `uv sync --locked --dev --python 3.14` and
`uv run --no-sync pytest ...` selected installed Python 3.14.0a6 and exited 139.
`uv python install 3.14`, `--managed-python`, and the CI uv version with a generic
3.14 selector still reused the alpha. Explicit stable 3.14.7 passes; no package
requirements were relaxed to accommodate the obsolete interpreter.

Browser environment:

```bash
source scripts/env.sh
export ROBOSPRAWL_E2E_PYTHON="$ROBOSPRAWL_ROOT/.artifacts/browser-backend/bin/python"
export ROBOSPRAWL_E2E_PREBUILT=1
export ROBOSPRAWL_E2E_ALL_BROWSERS=1
export ROBOSPRAWL_E2E_API_PORT=18000
export ROBOSPRAWL_E2E_WEB_PORT=13100
```

<!-- BROWSER_RESULTS_START -->
| Browser command | Result |
| --- | --- |
| `python3 scripts/e2e/check_runner.py` | All five failure/interruption cleanup cases passed |
| `bash scripts/e2e/run-mock-playwright.sh --project=chromium` | 39 passed, exit 0; existing visual baselines unchanged |
| `bash scripts/e2e/run-mock-playwright.sh --project=firefox` | 37 passed, exit 0 |
| `bash scripts/e2e/run-mock-playwright.sh --project=webkit` | 37 passed, exit 0 |
| `bash scripts/e2e/run-mock-playwright.sh --project=webkit --grep='opens compact on landing\|an unknown run keeps' --repeat-each=10 --retries=0` | 18 passed / 2 failed, exit 1; advisory under existing policy |

WebKit completed test failures are advisory; setup/runner/cleanup failures remain
required. All runs use zero retries and unchanged visual baselines.

Both stress failures are the existing `run-recovery.spec.ts:39` toast-dismissal
click timing out at 60 seconds: the element is unstable, then detaches while
Playwright retries. The full WebKit suite passes that same scenario. The ten
resize repetitions pass; recovery passes eight of ten. No test, timeout,
assertion, visual baseline, or policy was weakened.

`BROWSER=webkit SUITE=stress TEST_OUTCOME=failure PLAYWRIGHT_EXIT_CODE=1 python3
scripts/e2e/evaluate_result.py` exits 0 and classifies the completed test failure
as advisory. The raw stress runner exit remains 1. Final cleanup checks confirm
all five browser runs removed disposable workspaces and stopped their owned
processes; API/web ports 18000/13100 are free.

Diagnostic directories under `.artifacts/e2e/`:

- Focused installed switch: `run-xhlukx6n` (1 passed).
- Chromium: `run-5yzwdwbz` (39 passed, 4.3 minutes).
- Firefox: `run-t1pl29w2` (37 passed, 4.6 minutes).
- WebKit full: `run-5rigxouo` (37 passed, 7.5 minutes).
- WebKit stress: `run-ba4d21_t` (18 passed / 2 failed, 8.5 minutes), with both
  `error-context.md`, screenshots, and trace archives retained.

Each directory retains backend/frontend logs, Playwright logs, HTML/JUnit
reports, and `result.json`. Policy and cleanup results are in
`.artifacts/webkit-policy.log` and `.artifacts/browser-cleanup.log`.
<!-- BROWSER_RESULTS_END -->

Roboz PR #16 at `38a13ed6c1a4790e035e0d95a1b21b8c1167fb7b` has a
successful GitHub aggregate **CI** check, including Python 3.13/3.14, quality,
distribution, and portable core checks on Windows and macOS. This does not
establish Hub CI success against the older Roboz main.

## Candidate archive SHA-256

- `robosprawl-0.1.0-py3-none-any.whl`: `93e237f44b66b31d3ab70b4edbe64431e606eadfcebac3d1d09fc7245c91a5d4`
- `robosprawl-0.1.0.tar.gz`: `bb8e777d1e9fefc6e9072513d53fea62f2dbc600f420445b2a21746bcb7220d4`

Dependency archive hashes and the full core release gate are recorded in the
Roboz report. CI must resolve Roboz `main` containing PR #16 before this Hub
adaptation can land. Local paired-candidate results do not claim that current
Hub CI against the older Roboz main passes. GitHub results and Linux browser
checks do not establish live provider behavior or native Safari/macOS support.


## Current-main CI prerequisite

[Hub CI run 34110224721](https://github.com/Tachion-Oy/robosprawl/actions/runs/34110224721)
passes dependency checkout and frontend verification. Python 3.13/3.14, quality,
and distribution fail because current Roboz main cannot import
`ExternalDependencyReference`; browser jobs are skipped and aggregate CI fails.
Confirmed with `gh pr view 13 --json state,isDraft,statusCheckRollup` and
`gh run view 34110224721 --log-failed` (both exit 0); logs are retained in
`.artifacts/pr-status.json` and `.artifacts/ci-failed.log`.

Keep PR #13 in draft. After Roboz #16 reaches main, rerun the complete Hub
workflow so its resolver selects that new main revision; an isolated failed-job
rerun can retain the old resolved SHA. Land only after required Hub CI is green.
The workflow and its dependency source have not been bypassed or weakened.
