# Testing

The [CI workflow](../.github/workflows/ci.yml) runs Python tests, lint, and types,
plus desktop lint, types, and build on pull requests, pushes to `main`, and
manual dispatch. Its check is named **CI**. The
[Full E2E workflow](../.github/workflows/e2e.yml) runs on every pull request,
pushes to `main`, and manual dispatch.

Follow [Testing practices](testing-practices.md) when adding tests and
[Contributing](../CONTRIBUTING.md) for proposal and PR requirements. Workflow
files are the source of truth for the complete automated checks.

## Local setup

Install uv, Python 3.13 or newer, Node.js 22.18 or newer, and npm. CI uses
Python 3.13 and Node.js 22. From the repository root:

```sh
uv sync --locked --dev
npm --prefix desktop ci
```

The normal tests use scripted endpoints and temporary data, with no provider
keys or live services. Desktop backend checks need rootless Podman on Linux.

## What each part checks

Application tests, the code supporting those tests, and tests of that support
code have different responsibilities:

| Location | Purpose | Execution |
| --- | --- | --- |
| `tests/unit/` | Fast Python behavior checks, including configuration | Default pytest and CI |
| `tests/contract/` | API serialization, schemas, and validation at component boundaries | Default pytest and CI |
| `tests/integration/` | Fresh Python package installations and their backend behavior | Explicit pytest command; Full E2E |
| `tests/support/` | Shared process helpers for the installation checks | Used by tests |
| `desktop/tests/` | Native Electron startup, bundled resources, IPC isolation, navigation, and shutdown | Desktop command; Full E2E |
| `desktop/backend-tests/` | Backend staging, layout, container smoke and lifecycle | Desktop commands; CI and Full E2E |

Unit tests include such behavior as project paths, run state transitions, and
mock-agent response handling. Repository configuration checks also live here.
For example, the RoboZ dependency check enforces an exact release (`roboz==...`),
an allowed package index, and a wheel entry in the lockfile. It reads local
configuration; it does not compare against PyPI's latest version. CI's
`uv sync --locked` already detects mismatched manifest and lockfile versions.

Contract tests protect an interface between components. The runtime-event
checks verify that HTTP payloads serialize event levels correctly, expose the
expected values in their JSON schema, and reject invalid values. Library
version rules are ordinary unit checks.

Integration tests create fresh virtual environments instead of using the
repository's existing `.venv`. They install the built application and run from
outside the repository's source directory, so missing packaged files cannot be
silently supplied by source imports. This verifies a fresh Python package
installation. The desktop backend checks separately verify building and
starting the API in Podman.

## PR checks

Run the same checks as CI:

```sh
uv run ruff check src tests scripts
uv run pyright
uv run pytest --cov-fail-under=90
npm --prefix desktop ci
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run build
npm --prefix desktop run test:backend:lifecycle
git diff --check
```

The default pytest run collects `tests/unit/` and `tests/contract/`, with coverage
for `robozium` and a 90% CI minimum. The installation suite runs
explicitly. Pyright checks the Python source, hub configuration, the model check
script, and test support; TypeScript checks the desktop sources and tests.

During development, run a focused test or file first, for example
`uv run pytest tests/unit/test_config.py` or
`cd desktop && npx playwright test environment.spec.ts`. Run the
applicable complete checks before submitting. For documentation-only changes,
review links, command accuracy, and Markdown rendering, then run
`git diff --check`; new behavior tests are unnecessary.

## Electron scaffold checks

The [desktop app's](../desktop/README.md) native UI tests run independently of
the container engine. Each test starts a fake HTTP backend
(`fakeBackend` in `desktop/tests/native.ts`) and launches the app with
`--backend-url` pointing at it, from outside the checkout with a temporary
profile. The fake backend serves one `preview` project whose launch opens a run
with three messages awaiting a reply, and three mock models; like the real
backend, it keeps the chosen model. Managed startup has a separate backend suite
below:

```sh
npm --prefix desktop ci
npm --prefix desktop run test:electron
```

On Linux, `test:electron` and `test:backend:electron` run Playwright on a private
Xvfb display (`scripts/virtual-display.ts`; install `xvfb`), so test windows
never take over your screen, with or without a desktop session. The suite uses one
worker and no retries, checks the version bridge and renderer isolation,
rejects untrusted IPC senders and navigation, and verifies native close and
reopening. Resource checks cover built JavaScript/CSS, unknown resources,
unsupported methods, malformed paths, traversal, and symlink escapes.
It cleans up its profiles and processes. Failure diagnostics are retained in
`desktop/test-results/` and `desktop/playwright-report/`.

`desktop/tests/startup.spec.ts` plays the launch animation and checks that it
fades only over a drawn HUD, and that startup failures show on the loading
screen with Retry. Other native tests emulate reduced motion, which settles the
animation at once (`skipIntro` in `desktop/tests/native.ts`).

`desktop/tests/theme.spec.ts` checks that the chosen theme and native window
background survive a restart without dropping other `settings.json` keys, that
an unreadable settings file opens dark and is never overwritten (the switch
still applies, with a warning), and that `setTheme` accepts only dark or light
from the trusted window and document. It also checks that the light
`--tune-*` knobs change button colours and that `1` restores them.

Frame checks cover the bundled fonts, mouse/keyboard theme switching, retained
focus, the model/theme/view Tab order, and both themes at 1260×780 and 640×420
client sizes with native zoom 1 and 1.25. The reference HUD box must fill the
window; header checks verify one ordered, centred row inside the window with
ellipsized labels and full-name tooltips. Divider checks verify square buttons
and centered, contained arrows in both themes and zoom levels, including
disabled states. Selector scenarios cover pointer selection, keyboard option
focus, Escape and outside dismissal, one open menu, and each view's content. A
model choice is one write that the backend keeps across a reload; the view
resets. Mock-run checks start from Runs Overview, verify Current Run becomes
available, and exercise returning to the same draft through the overview and
view selector. They cover multiline editing, caret retention during
resizing/theme/zoom changes, bounded divider movement, disabled limits, a reload
that keeps the run but not the draft, and independent scrolling
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

Footer checks exercise all four history directions, disabled boundaries,
retained selection/draft/divider state, and Clear keeping the same textarea.
Clipboard tests run on the isolated Xvfb display and
assert exact native clipboard text, including whitespace and newlines. They
cover renamed success labels, two-second feedback expiry, content invalidation,
native write failure and retry, invalid payloads, untrusted windows/documents,
and continued browser permission denial. Only Electron main writes the native
clipboard; the renderer's typed bridge provides no read operation.

Footer geometry joins the full size/theme/zoom and three-divider-position
matrix. Checks assert centered navigation, contained controls, centered icons,
readable labels, and no document overflow. Resizing across wrap boundaries
preserves helper focus, DOM identity, and visible copy feedback in the
right-edge column. Two
additional footer screenshots show populated drafts and enabled helpers in both
themes. A Markdown check confirms sanitized rendering and that links neither
navigate nor open windows.
The native test fixture and capture helpers are shared by the scaffold and
footer scenarios.

Toast checks use refused cancellations, failed launches, clipboard failure and
Environment reset through the native fixture backend. They cover top-centre
overlay placement and containment at 640×420 with 125% zoom in both themes,
assertive errors and polite successes, pointer/keyboard dismissal with retained
focus, exit removal, five-second expiry, hover pause, same-title replacement and
independent stacking. The viewport has no inline styles or CSP violations. Native
captures in both themes are attached for review.

Desktop transport tests also run in this suite, using disposable loopback HTTP
servers and the actual client. They cover JSON request policy, origin/redirect
rejection, HTTP status and safe detail, malformed JSON, cancellation, SSE UTF-8
and line/chunk boundaries, comments/multiline data, stream errors, early disposal,
and reader cleanup. Direct framing checks split decoded text at every boundary
without involving JSON parsing or a stream reader. An open-stream regression
dispatches CR-terminated events without another chunk or EOF and checks split
CRLF handling.
The shared client streams any supplied SSE path; the typed run-stream wrapper
encodes its run ID, ignores unknown events and closes the HTTP response on early
exit, abort or invalid consumed payloads.

Connected model-selection tests in `desktop/tests/selection.spec.ts` run the built
renderer against a disposable HTTP server. The fixture replaces only the connection
bridge and protocol registration to select that server; there are no production
test controls or browser dependencies. Scenarios cover delayed acknowledgement,
rejected and malformed writes, empty/malformed catalogues, explicit Retry,
ten-second read/write deadlines, and reload cancellation. Lost-acknowledgement
regressions commit a model change before its response times out, then recover by
reading the backend or explicitly selecting the old displayed choice. Reconnect
regressions change the backend default, cancel stale reads/pending writes, preserve
local drafts and the overview, and verify recovery reads without automatic write
retries or reloading models on each healthy readiness poll.

Connected overview tests in `desktop/tests/overview.spec.ts` use the same server.
They cover status rows and per-status actions, three-second polling only while
the overview is visible and through failed reads, New Project's single creation
followed by the capability save and run creation, a failed launch keeping the
selector draft and reusing the created project, Tools restoring saved choices,
Escape and Cancel, inline capability load errors with Retry, rows that are not
buttons, Open on active runs and the current one, stop and delete settling through listings
with their refusal and failure alerts, and long names in both themes at
normal/narrow sizes and 125% zoom. `backend-ipc.spec.ts` checks that the CSP adds
only `img-src 'self'` and that the overview's display art loads.

Connected reply tests in `desktop/tests/replies.spec.ts` cover Enter and Send
posting one trimmed reply, Shift+Enter and IME composition not sending, the draft
clearing only when unchanged, a late snapshot unable to revive an answered prompt,
rejection, refusal and timeout keeping the draft without repeating the write, an
in-flight reply abandoned when another run opens, and Send staying unavailable
while the agent works. The native lifecycle run test answers both mock prompts
through the HUD and returns to the overview at completion.

`desktop/tests/run-controls.spec.ts` covers Cancel (interrupt) being offered only while
the agent works and staying pending until a prompt appears, interrupt refusal,
rejection and timeout without repeating the write, HUD Stop and the overview
row sharing one cancellation before the cancelled run returns to the overview, a
failed HUD cancellation, and a completed run returning while keeping the draft.
`runs.spec.ts` checks that failed, cancelled and missing runs return to the
overview. The lifecycle suite cancels a mock run from the HUD.

Connected run tests in `desktop/tests/runs.spec.ts` use the same native HTTP
boundary. They cover launch guards, the launch sequence (saved capabilities are
resolved and saved before the run is created with them), locked and invalid
selections, malformed catalogues, creation rejection/malformed responses/timeouts,
late snapshot/SSE overlap, duplicate chunks/messages, partial completion, polling
without events, terminal states, unknown runs, explicit retry without creation,
view retention, changed-run disposal, and unmount cancellation. Controlled clocks
verify the two-second interval after reads settle and ten-second request deadlines.
Closure and HTTP 409 cases hold an in-flight snapshot open, verify the fresh read
waits for it, and check that terminal completion stops polling without reconnecting.
`desktop/tests/reconnection.spec.ts` covers quiet reconnection after a refused
stream with 0.5/1/2/4-second backoff reset by the next frame, a lost connection
recovering output without duplicates while keeping the draft, failed polls
keeping their cadence, and a non-retryable stream refusal reported once with
Retry output. A snapshot deadline aborts the read and polling continues.
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
The container native suite creates/selects a project through the UI, starts it,
observes both mock prompts, and verifies completed history. Its test helper submits
required replies over HTTP; desktop Send remains disabled in this increment.

Linux screenshot baselines live beside the native tests. Review visual changes
against the experiment before explicitly updating them:

```sh
npm --prefix desktop run test:electron -- --update-snapshots=all --grep 'frame fits|footer keeps'
```

Ordinary runs never create or update baselines. Run without `--update-snapshots`
to validate the reviewed images. Panel resizing uses 220ms ease
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
own dependencies.
CI sets `DEBUG=pw:browser` and saves combined command output in
`.artifacts/desktop/electron-launch.log`, uploaded with failure reports. This
includes native errors before Playwright's Electron launch resolves; the
fixture's per-test log cannot capture that stage. For local launch debugging,
use `DEBUG=pw:browser npm --prefix desktop run test:electron`.

CI checks desktop lint, types, and compilation. Full E2E runs the native suite on
Ubuntu with Chromium sandboxing enabled, split across two Electron scaffold shards
that must both pass.

## Desktop backend checks

With rootless Podman (`sudo apt install podman uidmap catatonit`) and Node.js
22.18 or newer:

```sh
npm --prefix desktop run test:backend
npm --prefix desktop run test:backend:container
```

These dependency-free checks live under `desktop/backend-tests/` and run in the
desktop backend lifecycle Full E2E job. They need neither Electron nor npm
dependencies. Normal desktop builds/native tests still work from a desktop-only
checkout; backend builds also need the shared Python source, lockfile, and
package metadata.

Staging checks cover the public allowlist, synthetic private-file exclusion,
symlink rejection, stale-output replacement, and stable build identifiers that
change when staged content changes. Layout checks cover bind paths and
read-only mounts, relocated paths, and required runtime and
hub selection.

The container smoke test runs the desktop's own controller and Podman engine: it
builds an API-only image, checks the image's non-root user and synthetic
credential exclusion, creates a project through the existing mock API, checks
that its files belong to the user running the test, and verifies data after
restart, recreate and shutdown. It uses a unique profile and dynamically
selected loopback port; live provider calls are never needed. On failure it
prints the container log and the API's own output, then removes its test containers and untags its image, keeping the layers as build cache. On success it verifies
host-data preservation before deleting the temporary runtime. Container options and
data locations are documented in the [desktop README](../desktop/README.md#backend-diagnostics-linux).

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

## Linux package check

The [Linux package workflow](../.github/workflows/package.yml) is a separate
required check, apart from Full E2E. It builds the `.deb` with
`npm --prefix desktop run package:linux`, keeps it as the
`robozium-desktop-deb` workflow artifact for 14 days, installs it with apt on the runner,
and starts the installed `robozium --mock` under Xvfb with a fresh `HOME`. It
waits for the packaged backend to report ready, checks that the profile was
created in `~/.config/Robozium`, then sends the app SIGTERM and requires it to
exit with no backend container left running. On failure it uploads the app log
and the profile's runtime logs. It then runs
[check-upgrade.mjs](../desktop/packaging/check-upgrade.mjs). The check installs the
latest release's `.deb`, or this build before the first release. It runs the live
app, creates a project in `~/Robozium-Hub` and saves an encrypted secret with a
password, then upgrades to the new `.deb`. It requires the project and the
installation identity to survive and the secret to unlock with its password. Profile and resource locations for installed and
checkout runs are unit-tested in `backend-tests/lifecycle/locations.test.ts`.

## Releases

Pushing a `v<version>` tag runs the [release workflow](../.github/workflows/release.yml).
The tag must match `desktop/package.json` and be newer than the latest release,
so apt upgrades to it. The workflow builds the `.deb` and signs a flat apt
repository with the `APT_SIGNING_KEY` secret. It installs from that repository
using the committed public key, runs the upgrade check from the previous release,
and attaches the repository files to the GitHub Release. Users' apt sources point
at `releases/latest/download`.

## Live model check

The [model check workflow](../.github/workflows/model-check.yml) runs on each
`v*` tag and on manual dispatch, never on pull requests. It runs
`uv run python scripts/model_check.py --provider openrouter` with the
`OPENROUTER_API_KEY` secret. Every model the application can select, and the
memory model, is sent with its configured request options, including reasoning
effort. Each selectable model receives the orchestrator's full system prompt,
built from the application's own deployment, with the greeting `hi`, and must
answer with a tool call the application can parse. A provider refusal of that
prompt fails the check. The memory model must reply to a one-word text prompt.
Models that accept images must also name the colour of a small red square. OpenRouter models must also match
OpenRouter's published image support, context limit and tool support. Output
is capped at 1024 tokens per request. Replies vary between requests, so each
probe is tried up to three times, and a model fails only when every attempt
does. Without `--provider`, providers whose
key is missing are skipped.

To change models, edit `models.json`, run `uv run roboz inventory generate`,
and commit both files.

## Full E2E policy

**Full E2E must pass in CI before merging.** Its **Full E2E** check fails when
any of its jobs fails or is cancelled: installation, the desktop backend
lifecycle, and the Electron scaffold in two shards. The `needs` list of that
check in the [workflow](../.github/workflows/e2e.yml) is the only list of its
jobs. Fork PRs use read-only permissions and credential-free mocks.

The change-scope job skips the jobs when a pull request changes only `docs/`
and `CHANGELOG.md`. Only the change scope skips jobs, so a failed or cancelled
change scope fails Full E2E. Merge queue runs, pushes to `main` and manual
dispatches always run every job.

Full E2E and the Linux package run only on pull requests into `main`. A pull
request stacked on another branch runs CI alone, and gets the full run once it
targets `main`: when it is updated after its parent merges, or in the merge
queue.

Installation has a 25-minute job limit. The desktop backend lifecycle has a
15-minute job limit; each Electron shard has a 10-minute job limit and no
retries. Flaky tests fail.

For local container reproduction, use a dedicated test checkout/project rather than
an existing user deployment; the workflow defines setup and cleanup.

## Desktop backend lifecycle checks

After installing desktop dependencies:

```sh
npm --prefix desktop run test:backend:lifecycle
npm --prefix desktop run test:backend:electron
```

The lifecycle unit suite runs Electron main's sources directly and exercises the
controller with scripted Podman/HTTP boundaries and real temporary files. It
checks discovery failure, rootless and subordinate-ID requirements, installation
identity and legacy settings, image reuse/rebuild, occupied ports, label/mount
ownership, readiness failure and retry, cancellation during build/run/readiness,
and shutdown ownership rechecks. It also checks the exact container options
(host network, container root as the user, no capabilities, no pulls), that
the container gets only the layout's values through a private file that is
removed once it starts, never the command line, and that remote Podman settings
and Electron's `disabled:` session bus are ignored.
Process tests execute disposable Node children to check bounded output, argument
isolation, timeout, forced cancellation, and safe failures. These checks run in CI.

The native backend suite stages real shared Python inputs and launches sandboxed
Electron on an isolated display with a temporary profile and unused loopback port.
Focused scenarios exercise a Podman-unavailable alert and Retry, duplicate-launch
ownership, and cancellation during a blocked build. A persistence scenario creates
and launches a project through the capability selector, exercises the
duplicate-name error, closes the native window, and verifies stopped containers
and retained data. Reopening that same installation must reuse its image and
list the project; named steps make
these dependent phases explicit. Logs and a startup-error capture are attached
to the report.
Native lifecycle captures wait for the renderer to observe a window resize before
applying zoom, then converge on both native zoom and renderer dimensions.
Controlled delayed-resize and late-zoom-reset regressions keep native window
synchronization from silently returning captures to 100% zoom.
Cleanup validates the exact temporary installation before removing its containers,
image tag, and test directory; it never uses `--volumes` or a user's hub.

Full E2E runs native lifecycle checks in the desktop backend lifecycle job. The
Electron scaffold job still uses a desktop-only checkout. Renderer tests also reject untrusted callers of the lifecycle and
connection-address IPC methods. Separate native scenarios block initial renderer
readiness and recover through Retry without Podman commands, and verify the
selected-address CSP with actual desktop HTTP/SSE requests against a seeded run.
The outage scenario stops only its disposable container. While it is down, the
mounted HUD keeps its editor identity, reply draft, output selection and divider
without a Retry output error. After restart it verifies the theme, resumed
polling and reloading the backend model selection; the restarted mock no longer
has the run, so the HUD returns to the overview and the next launch offers the
kept draft.
Outage captures and containment
checks cover both themes at 1260×780 and 640×420, including 125% zoom. No production
demonstration controls are added; the test loads the actual transport source into
its renderer through Playwright. A lifecycle scenario saves a throwaway secret
with a test password through the environment API, reopens the app, checks that
the password dialog opens after startup, cancels it, sees a launch ask again,
rejects a wrong password, unlocks and launches. `desktop/tests/secrets.spec.ts`
covers no dialog without locked secrets, the dialog after the startup screen, a
wrong password, the pending lock against Escape, cancelled and unlocked launches
and replies, and a 423 opening the dialog.

`desktop/tests/dependencies.spec.ts` covers a failed load recovered by Check
Now, the empty state, the availability count, sorting by status and ID in both
directions, copying a diagnostic through the native clipboard, a failed check
keeping the rows, Checking while a check runs, and Restart/Recreate calling
their IPC channels one at a time, reporting failures and restarting readiness
polling. Long identifiers, metadata and diagnostics stay inside their cells in
both themes at 1260×780 and at 640×420 with 125% zoom; captures are attached.
Lifecycle tests check that restart and recreate verify ownership before
running their exact Podman commands, run one at a time, make shutdown wait,
and leave a replaced container untouched.

`desktop/tests/environment.spec.ts` covers a failed load with Retry and masked
secrets, editing disabled while work is active, validation of a new secret, the
encryption password and its confirmation with the exact save body, a refused
save keeping edits that polling does not overwrite, edits surviving a screen
change and Escape closing the editor, the two-step reset, and both themes at
narrow and 125% zoom with an open editor. A lifecycle scenario saves a setting
through the screen and finds it again after reopening. The same spec covers a
folder import uploading only the files its `robozium.json` lists, each under its
relative path, a folder without a catalog refused before upload, a refused import,
and Restart app confirming unsaved edits in the HUD; `backend-ipc.spec.ts`
denies `restartApp` to untrusted windows and documents. A lifecycle scenario
saves a secret with a test password, uses Restart app (recording
`app.relaunch` and waiting for a clean exit, then starting again), unlocks it,
launches, then resets the environment and restarts without secrets.

`tests/unit/test_desktop_access.py` checks accepted/rejected origins and Hosts,
explicit preflight policy, native requests, Fetch Metadata, no policy without
a desktop port, CORS headers on unhandled storage-error responses, Environment request
limits/storage/busy gates, and locked provider actions.
The existing Environment and credential suites remain in the default Python run.

Desktop layout coverage also relocates log and local-extension directories in an
isolated copy of `desktop/src/backend-layout.json`, prepares the runtime from
it, and checks the resolved bind mounts' paths and permissions. It checks that preparation leaves local package directories
empty and creates only the separately mounted read-only folder inside the hub.
The container smoke test starts with those mount sources and verifies that the API
creates a project which survives restart and shutdown. These checks cover the
boundary between desktop mount preparation and hub-owned application storage.
