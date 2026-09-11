# CI-equivalent validation

Use Linux, Python 3.13 or 3.14, Node 22, and uv 0.12.10. CI checks out only
RoboSprawl and installs the exact Roboz dependency releases from `uv.lock`.
The three Roboz packages and ordinary dependencies use PyPI. A sibling Roboz
checkout and private dependency token
are not required. Missing indexed artifacts or mismatched hashes fail the check;
there is no source-checkout fallback. Browser jobs install the application build
and downloaded dependency wheels from the same workflow run.
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
uv run --locked python scripts/roboz_wheels.py --dist "$candidate_dir"
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

Build into fresh directories. `scripts/roboz_wheels.py` downloads the three
universal dependency wheels from the registry URLs in `uv.lock` and verifies
their hashes. Its `--check` mode verifies existing artifacts without network
access; stale versions, local lock sources, and hash mismatches fail.
The archive checker verifies metadata/content,
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

Chromium and Firefox are required. WebKit is temporarily advisory: both its full
suite and its 20 repeated scenarios continue running in parallel. Only their
test steps use `continue-on-error`. After successful service setup and cleanup,
the runner emits `playwright_exit_code` to `GITHUB_OUTPUT`; the required result
evaluator accepts exit 1 as advisory only for a failed WebKit test step. It
records a warning and summary, leaving the WebKit job and aggregate CI green.
Missing completion output, abnormal termination, setup, service, and cleanup
failures remain required. Local runner exit codes are unchanged. Python,
quality, frontend, distribution, Chromium, and Firefox remain required. Reports use `browser-<browser>-<suite>` artifact names,
where suite is `full` or `stress`. On CI, `failOnFlakyTests`
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

The minimized-widget geometry check waits for its scale transition to finish
before measuring. The light-theme hover check waits for the reply-ready state
before moving the pointer, then waits for the CSS transform; a short enclosing
retry timeout must not interrupt the browser's actionability wait.
Project-action padding uses locator CSS assertions so polling can replace rows
without leaving the check with a detached node. The comprehensive resize scenario
has a 120-second total budget for its landing, run, theme, zoom, and mobile phases;
individual action and assertion timeouts remain unchanged.

## Required status and publication

Use the aggregate **CI** check for branch protection. It requires Python,
quality, frontend, distribution, and every browser job to
succeed after WebKit test outcomes are classified as described above, including
when another job failed or was cancelled. PRs, main pushes, and manual runs use
read-only permissions, no persisted checkout credentials, immutable action
pins maintained by Dependabot, cancellation of superseded runs, and bounded
job timeouts. Artifacts are retained for 14 days. See
[GitHub secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

Local success is not a GitHub Actions result. Linux browser suites do not prove
native Safari/macOS application support or live provider behavior. No provider credentials
or private dependency credentials are needed by these checks. Actual GitHub
results must be reported separately. On 2026-09-05, `main` was unprotected and GitHub
reported rulesets unavailable under the repository's current plan. Requiring
aggregate **CI** remains a repository-settings follow-up when the plan or
visibility permits it.

### Retiring the dependency checkout token

The workflow no longer references `ROBOZ_CI_TOKEN`. After the credential-free CI
run succeeds, the owner can remove its Actions and Dependabot secret entries and
revoke the dedicated read-only token. Older branches that still check out Roboz
may continue needing it until they adopt this change.

### Published dependencies

The exact Roboz, Roboshed, and Endpoints releases are locked from production
PyPI. The downloader verifies the registry host, filenames, and SHA-256 hashes;
it never substitutes a local checkout or searches another index when an artifact
is missing. Consumer checks build RoboSprawl candidates but do not publish them.
