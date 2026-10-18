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
not installed. Docker onboarding requires Docker Compose v2.24 or newer and
host networking; Docker Desktop needs version 4.34 or newer with host networking
enabled. Reserve host port 8000 and the configured web port for container checks.
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
| `desktop/tests/` | Native Electron startup, bundled resources, IPC isolation, navigation, and shutdown | Desktop command; Full E2E |
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
npm --prefix desktop ci
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run build
git diff --check
```

The default pytest run collects `tests/unit/` and `tests/contract/`, with coverage
for `robozium` and a 90% CI minimum. Installation and infrastructure suites run
explicitly; a default run launches no browser services. Vitest collects
`web/tests/**/*.test.ts` and `.test.tsx`, excluding runner probes. Pyright checks
the Python source, hub configuration, container capability check, and test support;
TypeScript checks the frontend and Playwright files.

During development, run a focused test or file first, for example
`uv run pytest tests/unit/test_config.py` or
`npm --prefix web run test:run -- tests/hooks/useDictation.test.ts`. Run the
applicable complete checks before submitting. For documentation-only changes,
review links, command accuracy, and Markdown rendering, then run
`git diff --check`; new behavior tests are unnecessary.

## Electron scaffold checks

The [desktop preview](../desktop/README.md) runs independently of Docker and the
browser application. Its native UI tests launch with `--preview` from outside
the checkout using temporary Chromium profiles. Managed startup has a separate
backend suite below:

```sh
npm --prefix desktop ci
npm --prefix desktop run test:electron
```

On headless Linux, prefix the test command with `xvfb-run -a`. The suite uses one
worker and no retries, checks the React version display and renderer isolation,
rejects untrusted IPC senders and navigation, and verifies native close and
reopening. Resource checks cover built JavaScript/CSS, unknown resources,
unsupported methods, malformed paths, traversal, and symlink escapes.
It cleans up its profiles and processes. Failure diagnostics are retained in
`desktop/test-results/` and `desktop/playwright-report/`.

Frame checks cover the bundled font, mouse/keyboard theme switching, retained
focus, the model/theme/view Tab order with Secrets skipped, and both themes at
1260×780 and 640×420 client sizes with native zoom 1 and 1.25. Header geometry checks verify the single
row, stable widths across model/view selections, narrow-window contraction,
the model width cap, contained controls, and ellipsized labels with full names
and tooltips. Divider checks verify square buttons and centered, contained arrows
in both themes and zoom levels, including disabled states.
Selector scenarios cover pointer selection, keyboard exploration,
prefix search, acceptance/cancellation, outside dismissal, one open popup, and
view placeholders. Choices survive theme/view changes and reset on reload;
preview selector interactions make no HTTP requests. Mock-run checks start from Runs
Overview, verify Current Run becomes available, and exercise returning to the
same draft through the overview and view selector. They cover multiline editing,
caret retention during resizing/theme/zoom changes, bounded divider movement,
focus transfer at disabled limits, reset on reload, and independent scrolling
with a long draft. All three panel layouts run through the size/theme/zoom matrix
with wrapping, containment, and document-overflow assertions. Native pixel samples
in both themes verify opacity against an injected contrasting underlay.
Both open popups are checked throughout the size/theme/zoom matrix, including
viewport containment, visible options, keyboard highlights, and long selected
labels. Four additional popup screenshots cover both selectors and themes at
640×420 with native zoom 1.25. Four panel screenshots additionally cover equal
and composer-expanded layouts at that size/zoom in both themes. The eight frame
screenshots show a started mock run with the default message-expanded layout.
Native key-input checks cover Ctrl-plus/equal/minus/zero and keypad zoom in/out,
including focus retention and a single zoom step per key press while a selector
is open.

Footer checks exercise all four history directions, disabled boundaries, focus
transfer, retained selection/draft/divider state, and Clear returning focus to
the existing textarea. Clipboard tests run on the isolated Xvfb display and
assert exact native clipboard text, including whitespace and newlines. They
cover success announcements, two-second feedback expiry, content invalidation,
native write failure and retry, invalid payloads, untrusted windows/documents,
and continued browser permission denial. Only Electron main writes the native
clipboard; the renderer's typed bridge provides no read operation.

Footer geometry joins the full size/theme/zoom and three-divider-position
matrix. Checks assert centered navigation, contained controls, centered icons,
readable labels, and no document overflow. Resizing across wrap boundaries
preserves helper focus, DOM identity, and visible copy feedback. Two additional
footer screenshots show populated drafts and enabled helpers in both themes.
The native test fixture and capture helpers are shared by the scaffold and
footer scenarios.

Desktop transport tests also run in this suite, using disposable loopback HTTP
servers and the actual client. They cover JSON request policy, origin/redirect
rejection, HTTP status and safe detail, malformed JSON, cancellation, SSE UTF-8
and line/chunk boundaries, comments/multiline data, stream errors, early disposal,
and reader cleanup. Direct framing checks split decoded text at every boundary
without involving JSON parsing or a stream reader. An open-stream regression
dispatches CR-terminated events without another chunk or EOF and checks split
CRLF handling. Preview remains local; its bridge returns no API address.
The shared client streams any supplied SSE path; the typed run-stream wrapper
encodes its run ID, ignores unknown events and closes the HTTP response on early
exit, abort or invalid consumed payloads.

Connected selection tests in `desktop/tests/selection.spec.ts` run the built renderer
against a disposable HTTP server. The fixture replaces only the connection bridge
and protocol registration to select that server; there are no production test
controls or browser dependencies. Scenarios cover delayed acknowledgement, rejected
and malformed writes, empty/malformed catalogues, explicit Retry, single submission,
creation followed by failed refresh, retained names/selections, cancelled obsolete
reads, ten-second read/write deadlines, and reload cancellation. Lost-acknowledgement
regressions commit a model change before its response times out, then recover by
reading the backend or explicitly selecting the old displayed choice. Reconnect
regressions change the backend default, cancel stale reads/pending writes, preserve
local drafts/selections, and verify recovery reads without automatic write retries
or reloading models on each healthy readiness poll. Native captures
and overflow checks cover long names in both themes at normal/narrow sizes and
125% zoom. Keyboard assertions retain input, row, selector, and Retry focus.

Connected run tests in `desktop/tests/runs.spec.ts` use the same native HTTP
boundary. They cover launch guards, creation rejection/malformed responses/timeouts,
late snapshot/SSE overlap, duplicate chunks/messages, partial completion, polling
without events, terminal states, unknown runs, explicit retry without creation,
view retention, changed-run disposal, and unmount cancellation. Controlled clocks
verify the two-second interval after reads settle and ten-second request deadlines.
Closure and HTTP 409 cases hold an in-flight snapshot open, verify the fresh read
waits for it, and check that terminal completion stops polling without reconnecting.
History, streaming scroll, exact clipboard content, retained drafts and keyboard
focus are exercised in both themes, including narrow windows at 125% zoom.
Native regressions also exercise provider retries, active prompts followed by
background notifications, and settled progress while a tool is running. Script
regressions verify navigation and copying after prefix recovery splits a group,
duplicate events clearing stale live text, and prompts separating pinned output.
`desktop/tests/session.spec.ts` exercises run reconciliation and HUD projection without launching
Electron: retry scoping/replay, prompt selection, settling, completed-token
suppression, snapshots overtaking SSE, and script identity across recovered
boundaries. Delivery-order cases cover repeated snapshots, older duplicates that
must leave newer live text intact, and delayed/status-only prompt snapshots whose
boundaries survive recovery. Separation checks exercise run reconciliation without
a HUD, selection changes leaving run data untouched, recovered scripts before a
live display boundary, and duplicate chunks after live text was cleared.
Mixed-content checks apply the same message and script grouping expectations to
streamed events and snapshot recovery, including hidden agent completions.
A 100,000-token case checks bounded retained records
and verifies that further tokens leave completed history untouched; it has no machine-specific
timing threshold. Run those checks alone with
`cd desktop && npx playwright test session.spec.ts --reporter=list`.
`desktop/tests/request.spec.ts` checks the shared deadline helper with controlled
timers: completion cleanup, cancellation reasons, custom/default deadlines and
late responses. API tests also validate run event normalization and status/role
contracts against literal wire fixtures.
The Docker native suite creates/selects a project through the UI, starts it,
observes both mock prompts, and verifies completed history. Its test helper submits
required replies over HTTP; desktop Send remains disabled in this increment.

Linux screenshot baselines live beside the native tests. Review visual changes
against the experiment before explicitly updating them:

```sh
xvfb-run -a npm --prefix desktop run test:electron -- --update-snapshots=all --grep 'frame fits|footer keeps'
```

Ordinary runs never create or update baselines. Run without `--update-snapshots`
to validate the reviewed images. Panel resizing uses the web HUD’s 220ms ease
transitions for flex-grow and flex-basis, disabled for reduced motion. Dedicated
native tests check intermediate geometry and reduced motion separately from
settled captures; selector checks verify stable header positions across view
labels and shrinking at narrow sizes. Tests wait for panel transitions, fonts,
the requested native viewport dimensions, and painting before capturing
the full client area through Electron. They also verify the image dimensions
so a cropped capture cannot become a passing baseline at native zoom.
The test launcher selects X11 and display scale 1 so host Wayland and monitor
scaling cannot bypass Xvfb or change the baseline dimensions.

The native CI job checks out only desktop and root files and installs desktop's
own dependencies. Browser CI continues to exercise the full checkout separately.
CI sets `DEBUG=pw:browser` and saves combined command output in
`.artifacts/desktop/electron-launch.log`, uploaded with failure reports. This
includes native errors before Playwright's Electron launch resolves; the
fixture's per-test log cannot capture that stage. For local launch debugging,
use `DEBUG=pw:browser xvfb-run -a npm --prefix desktop run test:electron`.

CI checks desktop lint, types, and compilation. Full E2E runs the native suite on
Ubuntu with Chromium sandboxing enabled and requires the Electron job to pass.

Reply scenarios in `desktop/tests/interactions.spec.ts` verify acknowledged draft
clearing, edits during submission, duplicate guards, obsolete prompts, keyboard/IME,
rejection and timeout recovery without repeating writes.

## Desktop backend checks

With Linux Docker Engine/Compose and Node.js 22.12 or newer:

```sh
npm --prefix desktop run test:backend
npm --prefix desktop run test:backend:docker
```

These dependency-free checks live under `desktop/backend-tests/` and run in the
existing Docker Full E2E job alongside the browser container checks. They need
neither Electron nor npm dependencies. Normal desktop builds/native tests still
work from a desktop-only checkout; backend builds also need the shared Python
source, lockfile, and package metadata, but no `web/` files.

Staging checks cover the public allowlist, synthetic private-file exclusion,
symlink rejection, stale-output replacement, and stable build identifiers that
change when staged content changes. Compose checks cover default
live mode, explicit mock mode, port/user overrides, credential-file precedence,
optional credentials, required runtime selection, bind paths/permissions,
readiness, loopback binding, and a single worker.

The Docker smoke test builds an API-only image, checks non-root execution and
synthetic credential exclusion from the image, creates a project through the
existing mock API, and verifies data after restart and shutdown. It uses a
unique project, temporary runtime, and dynamically selected loopback port; live
provider calls are never needed. On failure it prints the exact project's API
logs, then removes its test containers/image without `--volumes`. On success it verifies
host-data preservation before deleting the temporary runtime. Manual startup and
data locations are documented in the [desktop README](../desktop/README.md#manual-desktop-backend-linux).

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

When fixing a browser flake, reproduce it in the pinned browser environment,
then repeat the affected tests with retries disabled. For example:

```sh
uv run python -m tests.support.browser --browser=webkit \
  --playwright-arg=nav-title.spec.ts --playwright-arg=--repeat-each=5 \
  --playwright-arg=--retries=0
```

Retain the original assertions and add a regression that controls the delayed
event or transition. A successful rerun alone does not establish a fix. Run
Full E2E on the PR and validate the same commit in a fresh workflow dispatch
when investigating differences between PR and post-merge results.

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

**Full E2E must pass in CI before merging.** Its aggregate check requires all seven
independent jobs to succeed: Chromium, Firefox, WebKit, installation, runner
infrastructure, Docker onboarding with restart recovery, and the Electron
scaffold. Failed, cancelled, missing, or skipped jobs fail the gate. Fork PRs use
read-only permissions and credential-free mocks.

The [shared workflow](../.github/workflows/e2e-browser.yml) pins the Linux browser
environment and installs locked dependencies. Browser jobs use the production
frontend, installed candidate backend, and a temporary hub with one worker each.
Review visual baselines in that pinned environment.

Playwright is pinned exactly to 1.59.1, with matching Docker and CI images.
The 1.64.0 WebKit build stalls animation frames while painting the terminal's
text shadows, causing ordinary clicks to time out. Validate a replacement
release with the existing suite before updating all three pins together.

Chromium and Firefox have 15-minute browser runner deadlines and 25-minute job
limits. WebKit has a 25-minute runner deadline and a 35-minute job limit.
Installation and runner infrastructure have 25-minute job limits. Docker
has a 15-minute job limit; Electron has a 10-minute job limit and no retries.
Browser jobs allow one retry and stop after three
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

## Desktop backend lifecycle checks

After installing desktop dependencies:

```sh
npm --prefix desktop run test:backend:lifecycle
xvfb-run -a npm --prefix desktop run test:backend:electron
```

The lifecycle unit suite compiles Electron main and exercises the controller with
scripted Docker/HTTP boundaries and real temporary files. It checks discovery
failure, Compose/daemon requirements, installation identity and legacy settings,
image reuse/rebuild, occupied ports, label/mount ownership, readiness failure and
retry, cancellation during build/start/readiness, and shutdown ownership rechecks.
Docker target tests preserve explicit context/host/TLS settings across retries
and reject failed or empty context resolution before changing containers.
Process tests execute disposable Node children to check bounded output, argument
isolation, timeout, forced cancellation, and safe failures. These checks run in CI.

The native backend suite stages real shared Python inputs and launches sandboxed
Electron on an isolated display with a temporary profile and unused loopback port.
Focused scenarios exercise a Docker-unavailable alert and Retry, duplicate-launch
ownership, and cancellation during a blocked build. A persistence scenario creates
projects through the labelled form, exercises duplicate-name errors and keyboard
selection/refresh, closes the native window, and verifies
stopped containers and retained data. Reopening that same installation must reuse
its image and projects while resetting the local selection; named steps make
these dependent phases explicit. Logs and a startup-error capture are attached
to the report.
Native lifecycle captures wait for the renderer to observe a window resize before
applying zoom, then converge on both native zoom and renderer dimensions.
Controlled delayed-resize and late-zoom-reset regressions keep native window
synchronization from silently returning captures to 100% zoom.
Cleanup validates the exact temporary installation before removing its containers,
image tag, and test directory; it never uses `--volumes` or a user's hub.
The same suite also drives the real Docker CLI against two simulated daemons
using a temporary Docker configuration. Switching its default context must leave
startup, retry, cancellation, and shutdown on the original daemon, with no
requests to the second daemon or changes to the user's Docker configuration.

Full E2E runs native lifecycle checks in the existing Docker job. The Electron
preview job still uses a desktop-only checkout. All seven existing jobs remain
required. Renderer tests also reject untrusted callers of the lifecycle and
connection-address IPC methods. Separate native scenarios block initial renderer
readiness and recover through Retry without Docker commands, and verify the
selected-address CSP with actual desktop HTTP/SSE requests against a seeded run.
The outage scenario stops only its disposable container to verify recovery,
retained editor identity, project-name draft and selection, reply draft,
divider/theme, resumed polling, and reloading the backend model selection.
Outage captures and containment
checks cover both themes at 1260×780 and 640×420, including 125% zoom. No production
demonstration controls are added; the test loads the actual transport source into
its renderer through Playwright. Credential-unlock controls remain a later increment.

`tests/unit/test_desktop_access.py` checks accepted/rejected origins and Hosts,
explicit preflight policy, native requests, Fetch Metadata, unchanged browser
mode, CORS headers on unhandled storage-error responses, Environment request
limits/storage/busy gates, and locked provider actions.
The existing Environment and credential suites remain in the default Python run.

Desktop layout coverage also relocates log and local-extension directories in an
isolated copy of `desktop/src/backend-layout.json`, runs the standalone runtime
preparation command, and compares its paths and permissions with Docker Compose's
resolved bind mounts. It checks that preparation leaves local package directories
empty and creates only the separately mounted read-only folder inside the hub.
The Docker smoke test starts with those mount sources and verifies that the API
creates a project which survives restart and shutdown. These checks cover the
boundary between desktop mount preparation and hub-owned application storage.

Desktop interaction scenarios also cover interruption followed by a reply,
cancellation during interruption, background status reconciliation and failed
controls retaining drafts.
