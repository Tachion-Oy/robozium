# Testing

The [CI workflow](../.github/workflows/ci.yml) runs Python tests, lint, and types,
plus frontend tests, lint, and types on pull requests, pushes to `main`, and
manual dispatch. Its check is named **CI**. The
[Full E2E workflow](../.github/workflows/e2e.yml) runs on pushes to `main` and
manual dispatch, not ordinary pull requests.

Follow [Testing practices](testing-practices.md) when adding tests and
[Contributing](../CONTRIBUTING.md) for proposal and PR requirements. Workflow
files are the source of truth for the complete automated checks.

## Local setup

Install uv, Python 3.13 or newer, Node.js, and npm. CI uses Python 3.13 and
Node.js 22. From the repository root:

```sh
uv sync --locked --dev
npm --prefix web ci
```

The normal tests use scripted endpoints and temporary data, with no provider
keys or live services. Docker onboarding requires Docker Compose v2.24 or newer.
Native browser-runner commands use Bash and POSIX process groups; use Linux or
a suitable Linux development environment for those checks.

## PR checks

Run the same checks as CI:

```sh
uv run ruff check src tests scripts
uv run pyright
uv run pytest --cov-fail-under=90
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run test:run
git diff --check
```

Pytest collects backend unit and contract tests under `tests/`, with coverage
for `robozium` and a 90% CI minimum. Vitest collects frontend tests under
`web/tests/`. Pyright checks the Python source and hub configuration; TypeScript
checks the frontend.

During development, run a focused test or file first, for example
`uv run pytest tests/unit/test_config.py` or
`npm --prefix web run test:run -- tests/hooks/useDictation.test.ts`. Run the
applicable complete checks before submitting. For documentation-only changes,
review links, command accuracy, and Markdown rendering, then run
`git diff --check`; new behavior tests are unnecessary.

## Browser checks

Install the browsers in the same environment used by the runner. On Linux,
`--with-deps` can require administrator access for browser system packages.
From the repository root in Bash:

```sh
source scripts/env.sh
npm --prefix web exec -- playwright install --with-deps chromium
npm --prefix web run test:e2e
```

For all supported browsers:

```sh
source scripts/env.sh
npm --prefix web exec -- playwright install --with-deps chromium firefox webkit
npm --prefix web run test:e2e:all-browsers
```

The runner builds the production frontend, starts a mock backend with a
disposable hub, and uses one API worker and one Playwright worker. It owns
startup and cleanup; invoking Playwright directly bypasses that setup and is
rejected by the browser configuration. Ensure the default test ports 8000 and
3100 are free, or set `ROBOZIUM_E2E_API_PORT` and `ROBOZIUM_E2E_WEB_PORT`.

Diagnostics are written beneath `.artifacts/e2e/`, including browser, backend,
frontend, resource, and technical logs. These files are ignored by Git.

## Full E2E policy

Full E2E starts four independent jobs: Chromium, Firefox, WebKit, and Docker
onboarding with restart recovery. Browser jobs each build the production
frontend, install the candidate backend and only their selected browser, then
use one Playwright worker and one API worker with a temporary hub. Chromium
additionally checks the wheel and source distribution and exercises runner
cleanup paths. Those archives validate internal installation; Robozium is not
published to PyPI. Docker uses its own fresh runner. A browser job finishing
early or failing does not cancel the others.

Chromium and Firefox have 15-minute browser runner deadlines and 25-minute job
limits. WebKit has a 25-minute runner deadline and a 35-minute job limit. Docker
has a 15-minute job limit. Browser jobs allow one retry and stop after three
failed tests. Flaky tests fail. Playwright output streams to Actions; browser,
backend, frontend, resource, and technical logs remain in the diagnostic artifact.

An ordinary, fully completed WebKit test failure is advisory. An interrupted or
timed-out suite, three-failure termination, top-level Playwright error, missing
completion report, service exit, or runner or browser-fixture setup/cleanup
error fails the job for every browser. The browser runner writes `result.json`
and Playwright writes `completion.json` so the evaluator can distinguish these
outcomes. Failure reports upload before the job limit.

Changes to deployment should exercise Docker onboarding and restart recovery;
changes to runs, persistence, or browser interactions should exercise the
relevant browser suite. Maintainers can dispatch Full E2E for a candidate branch.
The workflow defines the disposable Compose setup and cleanup; use a dedicated
test checkout/project when reproducing it locally, rather than an existing user
deployment.
