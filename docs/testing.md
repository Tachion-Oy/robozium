# CI-equivalent validation

Use Linux, Python 3.13 or 3.14, Node 22, and uv 0.12.10. CI checks out
`robosprawl/` and `roboz/` as siblings. The dependency pin remains
`4e531215c69aec42e82af24e47f06c871b896f82`; neither manifests nor locks are rewritten.
Windows/macOS application support is not claimed by the existing Linux launchers.

```bash
source scripts/env.sh
uv sync --locked --dev
npm --prefix web ci
uv run pytest --cov-fail-under=90 --cov-report=xml:.artifacts/reports/coverage.xml \
  --junitxml=.artifacts/reports/pytest.xml
uv run ruff check src tests scripts
uv run pyright
npm --prefix web run typecheck
npm --prefix web run test:run
npm --prefix web run lint
```

Run backend tests on both Python versions in separate environments. The backend
statement-coverage floor is 90%; frontend unit checks run once, separately from
browser jobs. Python runtime level/HTTP schema and index-protocol regression
contracts live in `tests/contract/`.

## Candidate archives and installed E2E

```bash
candidate_dir="$(mktemp -d)"
uv build --no-sources --all-packages --project ../roboz --out-dir "$candidate_dir"
bash scripts/verify-wheels.sh "$candidate_dir"
# Keep a separate fresh pip environment for browser jobs:
backend_env="$(mktemp -d)/backend"
uv run python scripts/check_distributions.py --dist "$candidate_dir" \
  --python-output "$backend_env"
export ROBOSPRAWL_E2E_PYTHON="$backend_env/bin/python"
export ROBOSPRAWL_API_BASE_URL=http://127.0.0.1:8000
npm --prefix web run build
export ROBOSPRAWL_E2E_PREBUILT=1
# CI installs system libraries too; this command can require sudo locally.
npm --prefix web exec -- playwright install --with-deps chromium firefox webkit
python scripts/e2e/check_runner.py
bash scripts/e2e/run-mock-playwright.sh --project=webkit \
  --grep='opens compact on landing|an unknown run keeps' --repeat-each=10 --retries=0
bash scripts/e2e/run-mock-playwright.sh --project=chromium
bash scripts/e2e/run-mock-playwright.sh --project=firefox
bash scripts/e2e/run-mock-playwright.sh --project=webkit
```

Build into fresh directories. The archive checker verifies metadata/content,
rejects direct source requirements, rebuilds the application wheel from its
source distribution with overrides disabled, and independently installs each
candidate with pip. It runs `pip check`, verifies installed import locations,
and runs composition plus a real HTTP create/stream/reply/completion cycle.
Development checks are locked; independent pip resolution tests the declared
consumer requirements. There is no editable-install shortcut in artifact E2E.
The Python wheel contains the backend; the production frontend is a separate
build artifact, passed unchanged to each browser job.

`ROBOSPRAWL_E2E_PYTHON` selects the installed backend interpreter.
`ROBOSPRAWL_E2E_PREBUILT=1` requires `web/.next/BUILD_ID`; otherwise the developer
wrapper builds the frontend. The backend starts with `python -I -m uvicorn
robosprawl.api.app:mock_app --factory` from a disposable configuration/data directory.
API and web ports default to 8000/3100 and are configurable through
`ROBOSPRAWL_E2E_API_PORT`/`ROBOSPRAWL_E2E_WEB_PORT`. Port checks use socket binding,
so even a non-HTTP listener is rejected. Existing services are never reused.

The runner owns all child process groups. It retains HTML/JUnit reports, traces,
screenshots, frontend/backend logs, structured technical logs, and cleanup
results in a unique `.artifacts/e2e/run-*` directory. Temporary project data is
removed after shutdown. `check_runner.py` deliberately exercises occupied API
and web ports, startup failure, test failure, and interruption, checking ports,
processes, diagnostics, and unchanged user config/data afterward.

The backend-restart test uses a file handshake inside the disposable workspace
to request a process crash/restart. No test-control HTTP route or production API
is added. It verifies persisted project data, stale running-state cleanup, and
starting a new run after recovery.

## Browser diagnostics and visual review

All Chromium, Firefox, and WebKit tests are required. On CI, `failOnFlakyTests`
rejects tests that pass only on retry. Retries exist for diagnostics, not for
turning a flaky run green. Chromium visual baselines stay immutable in CI;
`updateSnapshots: 'none'` also makes local baseline changes intentional. To
propose a deliberate local baseline change, use the documented Playwright
`--update-snapshots` override, review every changed image, then rerun with updates
disabled. This implementation changes no baseline images.

The WebKit geometry assertion waits for the resulting layout after progress
changes. Unknown-run recovery dismisses the toast immediately after it appears, before
waiting for route/layout recovery or observing a later polling interval. The
two repeated scenarios cancel their active projects afterward, avoiding an
accumulation of background Librarians during stress runs.

## Required status and publication

Use the aggregate **CI** check for branch protection. It requires Python,
quality, frontend, distribution, and every browser job to succeed, including
when another job failed or was cancelled. PRs, main pushes, and manual runs use
read-only permissions, no persisted checkout credentials, immutable action
pins maintained by Dependabot, cancellation of superseded runs, and bounded
job timeouts. Artifacts are retained for 14 days. See
[GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Local success is not a GitHub Actions result. Linux browser suites do not prove
native Safari/macOS application support or live provider behavior. No provider credentials
are needed by these checks. Cross-repository checkouts require public access
to both pinned repositories; the anonymous-access limitation is recorded in
[verification](verification.md). Actual GitHub results and controlled live checks
must be reported separately.

When dependencies are published to PyPI, remove the three temporary
`tool.uv.sources` overrides, run `uv lock`, review the lock diff, and use locked
sync plus the same independent archive installation gate. See
[uv packaging guidance](https://docs.astral.sh/uv/guides/package/).
Changing a pin or passing validation does not authorize tags or publication.
