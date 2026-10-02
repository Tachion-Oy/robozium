# Testing

The [CI workflow](../.github/workflows/ci.yml) runs Python tests, lint, and types,
plus frontend tests, lint, and types on pull requests, pushes to `main`, and
manual dispatch. Its check is named **CI**. The
[Full E2E workflow](../.github/workflows/e2e.yml) runs on every pull request,
pushes to `main`, and manual dispatch.

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
keys or live services. Launcher tests use disposable fake Docker and SafeScripts
executables, including checks with optional commands absent. Host-process
integration tests additionally use Process Compose v1.122.0 and skip when it is
not installed. Docker onboarding requires Docker Compose v2.24 or newer.
Native browser-runner commands use Bash and POSIX process groups; use Linux or
a suitable Linux development environment for those checks.

## What each part checks

Application tests, the code supporting those tests, and tests of that support
code have different responsibilities:

| Location | Purpose | Execution |
| --- | --- | --- |
| `tests/unit/` | Fast Python behavior checks, including configuration and browser-result handling | Default pytest and CI |
| `tests/contract/` | API serialization, schemas, and validation at component boundaries | Default pytest and CI |
| `tests/integration/` | Fresh Python package installations and their backend behavior | Explicit pytest command; Full E2E |
| `tests/support/` | Shared code for building, starting, seeding, and stopping test services | Used by tests and the browser launcher |
| `tests/infrastructure/` | Startup, failure, interruption, and cleanup of the test machinery | Explicit pytest command; Full E2E |
| `web/tests/` | Frontend state, hooks, parsing, and component behavior through Vitest | CI |
| `web/e2e/` | Application interactions in real browsers through Playwright | Browser commands; Full E2E |
| `tests/container/` | Docker onboarding and restart recovery | Full E2E |

Unit tests include such behavior as project paths, run state transitions, and
mock-agent response handling. Repository configuration checks also live here.
For example, the RoboZ dependency check enforces an exact release (`roboz==...`),
an allowed package index, and a wheel entry in the lockfile. It reads local
configuration; it does not compare against PyPI's latest version. CI's
`uv sync --locked` already detects mismatched manifest and lockfile versions.

Contract tests protect an interface between components. The runtime-event
checks verify that HTTP payloads serialize event levels correctly, expose the
expected values in their JSON schema, and reject invalid values. Library
version rules and decisions about browser success are ordinary unit checks.

Integration tests create fresh virtual environments instead of using the
repository's existing `.venv`. They install the built application and run from
outside the repository's source directory, so missing packaged files cannot be
silently supplied by source imports. This verifies a fresh Python package
installation. Docker onboarding separately verifies the supported user path of
building and starting the application through Docker Compose.

There is one application browser suite: `web/e2e/`. It starts with a production
frontend and mock backend, then Playwright acts as a user: creating projects,
starting runs, replying to prompts, navigating message history, cancelling,
and recovering after restart. The mock supplies scripted model responses, but
the browser, frontend, and backend work together through real HTTP and SSE.

The Python package `tests/support/browser/` builds and manages those services
and invokes Playwright. It contains no application test cases and is not used
by the application itself. Shared process helpers find a free port, wait for
readiness, and stop process groups. Infrastructure tests verify this support
code by deliberately causing failures and checking that processes stop, ports
are released, temporary data is removed, and diagnostic logs are retained.
Their Playwright probes live under `web/tests/fixtures/browser-runner/` and are
selected only for infrastructure checks, outside the application browser suite.

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

The default pytest run collects `tests/unit/` and `tests/contract/`, with coverage
for `robozium` and a 90% CI minimum. Installation and infrastructure suites run
explicitly; a default run launches no browser services. Vitest collects
`web/tests/**/*.test.ts` and `.test.tsx`, excluding runner probes. Pyright checks
the Python source, hub configuration, and test support; TypeScript checks the
frontend and Playwright files.

During development, run a focused test or file first, for example
`uv run pytest tests/unit/test_config.py` or
`npm --prefix web run test:run -- tests/hooks/useDictation.test.ts`. Run the
applicable complete checks before submitting. For documentation-only changes,
review links, command accuracy, and Markdown rendering, then run
`git diff --check`; new behavior tests are unnecessary.

## Installation checks

Build and install the wheel and source archive in disposable environments:

```sh
uv run pytest tests/integration --no-cov -q
```

The tests use `uv export --locked` and install dependencies with lockfile hashes
and a published RoboZ wheel. They check archive contents and installed imports,
then run composition, private-capability, and HTTP stream/reply checks outside
the source tree. Diagnostic logs and JUnit results are retained in
`.artifacts/distribution-reports/`. Set `ROBOZIUM_DIST_DIR` to test already-built
archives. These checks require package-index access.

## Browser checks

Local E2E is optional for development and debugging.

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

The npm commands invoke `python -m tests.support.browser` through a thin shell
launcher. This support package builds the production frontend once, starts a
mock backend with a disposable hub, and uses one API worker and one Playwright
worker. It owns startup and cleanup; invoking Playwright directly bypasses that
setup and is rejected by the browser configuration. Ensure the default test
ports 8000 and 3100 are free, or set `ROBOZIUM_E2E_API_PORT` and
`ROBOZIUM_E2E_WEB_PORT`.

Select a browser or forward Playwright arguments through the support package:

```sh
uv run python -m tests.support.browser --browser=firefox
npm --prefix web run test:e2e -- --playwright-arg=--grep=restart
```

`--project` is an alias for `--browser`; without either option the suite runs
each browser sequentially. Use `--playwright-arg` for each Playwright argument,
including file filters. `ROBOZIUM_E2E_PREBUILT=1` reuses an existing frontend
build, and `ROBOZIUM_E2E_PYTHON` selects an installed candidate backend. Any
selected browser failure makes the command fail, even if a later browser
passes. Interruption cleans up and stops the command before later browsers
start. The old direct pytest browser wrapper has been removed; use the npm
commands or package entry point above.

Diagnostics are written beneath `.artifacts/e2e/`, including browser, backend,
frontend, and technical logs. These files are ignored by Git.

## Checks of test infrastructure

With Chromium installed, run:

```sh
source scripts/env.sh
uv run pytest tests/infrastructure --no-cov -s
```

These checks test the runner rather than application interactions. They cover
occupied ports, failed startup, suite and runner deadlines, service exit,
interruption, retries, and cleanup errors. They share the browser support
package and build the frontend once unless `ROBOZIUM_E2E_PREBUILT=1` is set.

Fast browser-result unit tests use synthetic runner and Playwright reports,
without starting browsers. They verify that completed success is accepted and
failed tests, flakes, missing reports, timeouts, and cleanup errors are rejected.
The infrastructure suite exercises those same decisions with real processes
and intentional Playwright failures. A deliberately failing probe is expected
to make its browser invocation fail; the infrastructure test passes only when
the runner reports that failure and cleans up correctly.

## Full E2E policy

**Full E2E must pass in CI before merging.** Its aggregate check requires all six
independent jobs to succeed: Chromium, Firefox, WebKit, installation, runner
infrastructure, and Docker onboarding with restart recovery. Failed, cancelled,
missing, or skipped jobs fail the gate. Fork PRs use read-only permissions and
credential-free mocks.

The [shared workflow](../.github/workflows/e2e-browser.yml) pins the Linux browser
environment and installs locked dependencies. Browser jobs use the production
frontend, installed candidate backend, and a temporary hub with one worker each.
Review visual baselines in that pinned environment.

Chromium and Firefox have 15-minute browser runner deadlines and 25-minute job
limits. WebKit has a 25-minute runner deadline and a 35-minute job limit.
Installation and runner infrastructure have 25-minute job limits. Docker
has a 15-minute job limit. Browser jobs allow one retry and stop after three
failed tests. Flaky tests fail. Playwright output streams to Actions; browser,
backend, frontend, and technical logs remain in the diagnostic artifact.

Any test failure, interrupted or timed-out suite, three-failure termination,
top-level Playwright error, missing
completion report, unexpected skips, incomplete execution, service exit, or
runner or browser-fixture setup/cleanup error fails the job for every browser.
Browser support writes `result.json` and Playwright writes `completion.json`;
the support package evaluates both after service cleanup. CI uses the browser
command's exit status directly. The optional synthetic credential-file case is
explicitly annotated as an expected skip unless its fixture is supplied; other
skips fail result evaluation. Failure reports upload before the job limit.

For local Docker reproduction, use a dedicated test checkout/project rather than
an existing user deployment; the workflow defines setup and cleanup.
