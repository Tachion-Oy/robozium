# CI-equivalent validation

Use Linux, Python 3.13 or 3.14, Node 22, and uv 0.12.10. CI checks out
`robosprawl/` and `roboz/` as siblings. The dependency pin remains
`f148023af667dc58c842d11f5a93843c2b0f1a8e`; neither manifests nor locks are rewritten.
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
robosprawl.api.app:mock_app` from a disposable configuration/data directory.
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
are needed by these checks. The private Roboz checkout does require the temporary
CI credential described below. Actual GitHub results and controlled live checks
must be reported separately. On 2026-09-05, `main` was unprotected and GitHub
reported rulesets unavailable under the repository's current plan. Requiring
aggregate **CI** remains a repository-settings follow-up when the plan or
visibility permits it.

### Temporary private dependency access

The workflow's default `GITHUB_TOKEN` is scoped to RoboSprawl and cannot read
private `Tachion-Oy/roboz`. Deploy keys are disabled for Roboz, so the dependency
checkout uses a dedicated fine-grained personal access token restricted to
reading that repository. Do not reuse a broad developer token.

1. Create a fine-grained token with **Resource owner: Tachion-Oy**, **Only select
   repositories: roboz**, **Contents: Read-only**, and a 30-day expiration (renew
   both secret entries if release takes longer). Metadata read access is implicit;
   no write permissions are needed. If organization approval is required, obtain
   it before running CI. Token creation requires the owner's GitHub session.
2. Store the token as `ROBOZ_CI_TOKEN` in RoboSprawl's **Actions secrets**
   and separately in its **Dependabot secrets**. Dependabot-triggered workflows
   cannot use Actions secrets; both entries must have the same name and value.
3. The three Roboz checkout definitions use `token` with that secret, retain
   the exact dependency revision, and remove credentials after checkout with
   `persist-credentials: false`. The Python matrix runs the same checkout twice.
4. Run a normal PR and a Dependabot PR through every gate. A missing credential
   must fail checkout and the aggregate check; do not bypass required jobs.

This setup supports same-repository PRs and Dependabot while Roboz is private.
Fork PRs do not receive the credential and cannot complete the dependency gates.
Do not switch to privileged PR triggers to expose it to fork code. See
[checkout authentication](https://github.com/actions/checkout#checkout-multiple-repos-private)
and [Dependabot secret handling](https://docs.github.com/en/code-security/reference/supply-chain-security/troubleshoot-dependabot/dependabot-on-actions#accessing-secrets).

### PyPI cutover

After compatible releases of **all three** packages (`roboz`, `roboz-shed`, and
`roboz-openai`) are available on PyPI:

1. Remove the three `[tool.uv.sources]` overrides, run `uv lock`, and review the
   registry sources and versions. Retain locked sync in CI.
2. Remove all three Roboz checkout steps from CI. Replace the Roboz build in the
   distribution job with `python -m pip download --only-binary=:all: --no-deps
   --dest "$candidate_dir"` and exact `name==version` arguments for the three
   packages, using their versions from the refreshed lock. Keep the directory
   fresh and preserve the existing artifact name.
3. Continue calling `bash scripts/verify-wheels.sh "$candidate_dir"`. Update
   that script's no-argument dependency preparation and the local candidate-build
   examples above to download the same released wheels instead of using a sibling
   checkout. The archive checker and browser wheel installation already accept
   those wheel filenames, so their interfaces do not need to change.
4. Require every gate on normal and Dependabot PRs with the checkout credential
   absent from the workflow. Then delete `ROBOZ_CI_TOKEN` from both secret stores,
   revoke the dedicated token, and update setup instructions to remove the
   sibling-checkout prerequisite.

Publishing the Git repository alone does not migrate CI to PyPI. If it becomes
public earlier, the `token` inputs and credential can be removed while retaining
the pinned source checkout. See [uv packaging guidance](https://docs.astral.sh/uv/guides/package/).
Changing a pin or passing validation does not authorize tags or publication.
