# Robozium

The Electron app is under development. React connects directly to the Python
API for projects, default model selection, and live runs. Select a project and
use **Start run** to watch incremental output, messages, script output, prompts,
and completion in Current Run. **Return to run** reopens the current session.
Light/Dark switches the theme, and Secrets unavailable is disabled. Replies,
credentials, and capability selection follow in later roadmap increments.

## Run on Linux

Requires Linux Docker Engine with Compose v2.24 or newer, Node.js 22.12 or newer,
and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Normal startup uses live mode. For a credential-free mock backend:

```sh
npm --prefix desktop start -- --mock
```

The start command stages the allowlisted Python source. Main builds the API
image on first launch and waits for readiness. React then checks `/ready` through
its HTTP client before showing the HUD. The first
build requires internet.
Later launches reuse the image when the staged inputs match its build identifier.
Startup failures show an explanation and **Retry**. Closing the window cancels
startup, waits for its Docker client to exit, and stops only the installation's
verified API containers. Containers, images, credentials, and host data remain.
A second managed launch using the same profile exits without changing its backend.
Docker's target is selected once at startup and retained for Retry and shutdown,
even if another terminal changes the current context. Explicit `DOCKER_CONTEXT`
and `DOCKER_HOST` settings retain Docker's normal precedence and TLS settings.
Restart the app to select a different target.

Managed app data lives in `.artifacts/desktop/data/`, with separate `live/` and
`mock/` runtime directories. A saved installation identifier scopes Docker project
ownership; existing experiment `settings.json` installation IDs and API ports
are read without rewriting the file. Defaults are live **18001** and mock **18000**.
Set `ROBOZIUM_DESKTOP_API_PORT` to an unused port to override that mode's port.
Stop the app before changing a port; existing containers with different ownership,
ports, or mounts are rejected. Do not share a hub between managed and manual runs.

Main selects your host UID/GID for rootful Docker or `0:0` for rootless Docker.
Provider configuration belongs in the selected runtime's `.env` or `.env.encrypt`;
see the [credential guidance](../README.md#optional-encrypted-credentials).
Keys and decryption remain in the Python backend. Startup opens the HUD
after the renderer connects; credential-unlock controls follow in PR 10.

Once connected, React checks readiness every five seconds with a three-second
timeout. A connection failure stops polling and shows an accessible notice with
**Retry**. The HUD stays mounted, preserving your draft, model/view and history
selection, divider position, and theme. Connection Retry checks the existing API
and resumes polling when ready; it does not rebuild or restart Docker. Backend
startup Retry still retries Docker setup. Preview makes no API requests.

Main supplies the controller's selected loopback address through the trusted
bridge and uses that same address in the bundled page's CSP. Application traffic
uses HTTP/SSE directly. With the desktop API port configured, Python accepts the
exact `robozium://app` origin and selected `127.0.0.1:port` Host, while retaining
originless native CLI/health checks. It rejects other origins/hosts and originless
browser requests carrying Fetch Metadata before invoking endpoints. Browser
deployment behavior is unchanged. No credentials or tokens enter the bridge.

Build/start diagnostics append to the mode's `.runtime/logs/docker.log`. For API
logs, use `docker logs --tail=200 <container>` with the API container from the
`robozium-desktop-<installation-id>-<mode>` project. Ownership failures leave
unrecognized containers alone; inspect the project and mounts before retrying.
Shutdown failures are reported on stderr and exit with a nonzero status.

For UI development without Docker or the shared Python checkout:

```sh
npm --prefix desktop run start:preview
```

Preview profiles stay in `.artifacts/desktop/scaffold/`. Close and restart either
command to rebuild after source changes. `.artifacts/desktop/data/` is persistent
user data; `desktop/.stage/` and `desktop/dist/` are regenerable build outputs.

The app starts in dark mode with Runs Overview selected. Connected mode loads
the backend's default model; preview uses the local Mock model fixture. Tab moves
through the model selector, theme button, and view selector, skipping Secrets.
Open a selector with a click, Enter, Space, or an arrow key. Use arrows, Home/End,
or type a name prefix to explore choices. Enter, Space, or Tab accepts the
highlighted choice; Escape or clicking the open trigger cancels. Clicking outside
accepts the highlighted choice and dismisses the popup. Only one popup opens at
a time. View choices survive theme changes and reset on reload. Connected model
choices change the displayed default only after backend acknowledgement. Failures
retain the last confirmed choice; **Refresh models** reads the current backend
state, while **Retry change** explicitly resubmits the failed choice. After an
uncertain write, selecting the displayed model also sends that choice again.
Successful refresh clears the pending retry. Both controls retain keyboard focus.
Connection recovery reloads the model catalogue and selection without replaying
writes or resetting drafts and local project selection.
Preview model choices stay local and reset on reload.

In connected Runs Overview, select a project row with a click, Enter, or Space.
Enter a **Project name** and press Enter or **Create project** to create it. Success
selects the returned slug and refreshes the list. A failed creation retains your
name; if only the follow-up refresh fails, use **Refresh** without creating again.
The list loads when entering Runs Overview and on Refresh, retaining existing
rows and selection on failure. The selected project and typed name survive view
changes and connection outages, and reset when the application reloads. Projects
remain stored in the Python backend.

Selection requests have ten-second deadlines and are cancelled on unmount.
Obsolete project reads are cancelled when refreshing or leaving Runs Overview.
Writes cannot overlap for the same operation and are never retried automatically.
A timed-out write may have reached the backend; refresh to check before retrying.

**Start run** requires a connected backend, a selected project, and a confirmed
model. It uses backend capability defaults and the acknowledged default model;
later model changes affect future runs. Creation has a ten-second deadline,
blocks duplicate submissions and model changes, and never retries automatically.
A timeout may still have prepared a backend run; check the backend before trying
again. Starting another run replaces the local subscription without cancelling
the previous backend run. The project label always identifies the captured run.

Opening the event stream starts the prepared run. A snapshot is read immediately,
then every two seconds after the previous read settles, with ten-second deadlines.
Snapshots and events merge by sequence/message identity. **Retry output** disposes
old requests and reconnects the known run ID without creating another run.
Errors preserve output and drafts. Completed, failed, and cancelled runs stay
readable and stop polling; unknown runs show **Run unavailable**. Automatic
reconnection and recovery after reopening are planned for PR 9.

In standalone preview, **Start run** opens the latest local mock message above
an empty reply editor. In either mode, draft freely: Enter and Shift+Enter insert
newlines; replies are not sent yet. The arrow buttons in the left rail move the
divider between message-expanded, equal, and reply-expanded positions. At each
limit, the unavailable direction is disabled. Messages and long drafts scroll
inside their own panels. Divider changes animate over 220ms, or move immediately
when reduced motion is enabled.

The footer's four history arrows select the first, previous, next, or latest
message without wrapping. New output follows the latest message unless you are
reading older history. An active prompt stays current even when a background
notification arrives afterward; the latest arrow returns to that prompt from a
pinned history entry. Provider retries discard abandoned partial text. Ordinary
agent-message completion keeps its last progress visible until new output or a
prompt replaces it. Live text scrolls downward; selecting another entry resets
its scroll. At either end, unavailable directions are disabled and keyboard focus
moves to the nearest reverse arrow. Empty history disables all arrows. The center
mark names the current run status, also shown above the output. Preview retains
three local messages and its static awaiting-input mark. Cancel, Interrupt,
Record, and Send remain disabled; draft editing stays local.

Output uses the existing text renderer. Rich Markdown and artifact-link rendering
remain tracked desktop parity work.

The run reducer owns run identity, durable event reconciliation, and backend
status. Run protocol values and derived types live in `run/run-contracts.ts`;
`api/request.ts` supplies deadlines for selection, run and readiness requests.
A separate desktop HUD reducer owns transient/settling text, prompt
identity, and the single-message panel's history selection. App reads one display
selector. Token deltas update only the active accumulator; completed attempts
retain message boundaries and completions instead of token chunks. Ordered
content appends incrementally, while recovered history is reconciled by sequence.
Script identities remain anchored when recovered prefixes or boundaries change
their groups. Replayed events still dismiss older live text. A new prompt closes
the preceding script group, and that boundary survives later history recovery.

**Clear reply** empties the draft and returns focus to the editor. **Copy reply**
and **Copy agent output** copy the exact displayed text, including whitespace
and newlines. Clear and Copy reply are disabled only for an empty draft. Copy
success shows a green checkmark for two seconds and is announced to assistive
technology; changing the copied content clears that feedback. Copy failure
shows a footer alert and allows retry. These controls appear only in Current
Run and wrap beneath the centered history controls when space is tight.

Switch views using the header, or use **Return to run** in Runs Overview. The
draft, selected message, and divider position survive view, model, theme,
window-size, and zoom changes. Reloading or restarting resets the desktop to
Runs Overview with no local session; it does not recover an existing run yet.
Dependencies and Environment still display “This view is coming soon.” Divider controls remain visible but disabled outside Current Run.

Both selectors reserve stable widths for their labels, so changing the model or
view keeps the other header controls in place. They shrink with the window;
truncated labels retain their full hover tooltips. Provider credentials and
environment editing arrive in later roadmap steps.

Use Ctrl++ or Ctrl+= to zoom in, Ctrl+- to zoom out, and Ctrl+0 to reset.
The keypad + and - keys also work with Ctrl.

## Checks

```sh
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run test:electron
```

On Linux without a display, run the tests with
`xvfb-run -a npm --prefix desktop run test:electron`.

See the [testing guide](../docs/testing.md#electron-scaffold-checks) for diagnostics
and CI details.

## Code layout

**Hard rule: do not hardcode filesystem locations in application code.** Resolve
paths from configured profile/runtime roots. Define bind-mount paths and
desktop-owned runtime file locations in the shared desktop layout configuration.
Use that definition for mount preparation, ownership validation, Docker logging,
and Compose integration. Repeating paths such as `.runtime/local-deps` or
`hub/readonly/safe-scripts` in controller or helper path lists is prohibited.

Desktop setup prepares the host folders Docker needs to mount, including the
nested read-only safe-scripts mount. The hub owns its application structure and
files within those mounts; desktop setup must not create or configure internal
directories such as `local/tools`, `local/skills`, or `local/imports`. The desktop
also owns its installation identity, Compose interpolation file, and Docker log.

- `src/` contains Electron main, preload, and the typed bridge. Main owns
  backend lifecycle. Native clipboard writes use `writeClipboardText(text)`,
  validating the window, main frame, document URL, and string payload. Browser clipboard permissions
  remain denied; the bridge exposes no clipboard-read operation. Backend IPC is
  limited to `getBackendConnection()`, `getBackendStatus()`, and `retryBackend()` with the same trusted
  document checks; it exposes no shell or Docker command interface.
- `src/backend-controller.ts` coordinates startup, readiness, retry, and shutdown.
- `src/docker-command.ts` runs one Docker CLI command, handling its output,
  timeout, and cancellation.
- `src/backend-profile.ts` exposes `loadOrCreateBackendProfile()`, which reads or
  creates the installation identity and selects the mode's runtime and port.
- `src/backend-layout.json` defines bind mounts and desktop-owned runtime file
  locations. Compose extends this configuration directly.
- `src/backend-layout.cjs` resolves and prepares that layout for Electron and
  `scripts/prepare-runtime.mjs`. TypeScript checks this shared Node module; the
  standalone setup command can also run before installing desktop dependencies.
- `renderer/src/ui/main.tsx` mounts backend startup and the application. Renderer
  `.tsx` components and their CSS live under `ui/`, grouped by feature. TypeScript
  hooks, contracts and state remain in the corresponding folders outside `ui/`:

  | Folder under `renderer/src/` | Responsibility |
  | --- | --- |
  | `ui/` | All rendered components and CSS: app composition, backend startup, projects, run launch and HUD controls. |
  | `app/` | Navigation definitions and standalone preview data. |
  | `backend/` | IPC connection discovery and HTTP readiness hooks. |
  | `projects/` | Project requests, validation and selection/creation state. |
  | `models/` | Model requests and validation, acknowledged backend selection and explicit retry. |
  | `run/` | Run contracts, requests, payload decoding, event reconciliation and live updates. |
  | `session/` | One run's request lifetime and atomic composition of run data with HUD state. |
  | `hud/` | Message projection, history, display selection and layout logic. |
  | `api/` | Shared HTTP/SSE transport, request deadlines and React request state. |
  | `assets/` | Bundled Anurati status-mark font. |

  UI components consume feature hooks/state; TypeScript feature modules do not
  import UI components. `ui/app/App.tsx` owns composition, theme and draft state;
  session coordinates run and HUD state. HUD projection consumes validated run
  data, while run reconciliation has no HUD dependency. Shared `api/` code imports
  no feature modules. App supplies header navigation choices separately from
  standalone preview data.
- `renderer/src/api/client.ts` owns direct JSON HTTP requests and SSE framing.
  It omits cookies, disables caching, rejects origin changes/redirects, preserves
  cancellation, and reports HTTP, malformed-response, and connection errors.
  `streamEvents(path, signal)` yields unknown JSON and releases its response reader
  on early disposal/abort. Feature APIs own endpoint paths and payload validation.
- `renderer/src/api/useRequest.ts` supplies pending/error state, cancellation and
  stale-response guards to the separate project and model hooks. `request.ts`
  provides deadlines shared with readiness and run requests.
- `renderer/src/run/run-api.ts` exposes typed creation, snapshot and stream
  operations. `run-payloads.ts` decodes snapshots and SSE through the same event
  validator. `run-updates.ts` coordinates concurrent streaming, serialized
  snapshots and polling with shared cleanup; `run-reducer.ts` owns backend state.
- `renderer/src/session/useRunSession.ts` owns creation and subscription lifetimes.
  `session-reducer.ts` composes run reconciliation and HUD projection atomically.
  `hud/hud-reducer.ts` coordinates live text, history and selection;
  `hud-history.ts`, `hud-view.ts` and `hud-messages.ts` own grouping/recovery,
  prompt/display composition and typed text extraction respectively.
  [PR 8 notes](../docs/plans/desktop-run-output.md) record browser sources and adaptations.
- `tsconfig.json` supplies Node types and module settings for every file in
  `src/`. Its standard name lets editors discover the same project used by the
  build. The test and Vite configurations extend it.
- `renderer/tsconfig.json` supplies the renderer's browser and Vite asset types
  to both the editor and the command-line type check.
- `tests/` contains native scenarios and screenshot baselines.

Keep new components in the corresponding `ui/` feature folder with their styles
beside them; keep hooks and state in the TypeScript feature folders.

## Manual desktop backend (Linux)

The desktop Docker configuration runs the existing Python API in its own
container. Electron normally manages startup and shutdown. The commands below
are for manual diagnostics using a separate project and runtime. The browser's
`./start` workflow is unchanged. These development commands require Linux Docker Engine with
Compose v2.24 or newer and Node.js 22.12 or newer; npm dependencies, host Python,
and `web/` are not needed to stage or run this backend.

From the repository root, stage the public backend sources:

```sh
npm --prefix desktop run backend:stage
```

This regenerates `desktop/.stage/backend/` from an explicit allowlist. It includes
locked Python dependencies, desktop-owned Docker/config files, and the existing
Python application. Symlinks are rejected. Credentials, private imports, hubs,
frontend files, and caches are excluded. The image retains the existing Linux
CLI tools and runs as UID/GID 10001 by default.

Select live mode (the Compose default):

```sh
export ROBOZIUM_MODE=live
export ROBOZIUM_DESKTOP_API_PORT=18001
```

For credential-free mock mode, use these two lines instead:

```sh
export ROBOZIUM_MODE=mock
export ROBOZIUM_DESKTOP_API_PORT=18000
```

Then prepare that mode's runtime and define a command scoped to its project:

```sh
export ROBOZIUM_DESKTOP_RUNTIME="$PWD/.artifacts/desktop/manual-data/$ROBOZIUM_MODE"
export ROBOZIUM_API_USER="$(id -u):$(id -g)"
ROBOZIUM_DESKTOP_COMPOSE_ENV="$(node desktop/scripts/prepare-runtime.mjs)"
desktop_compose() {
  docker compose --project-name "robozium-desktop-manual-$ROBOZIUM_MODE" \
    --env-file "$ROBOZIUM_DESKTOP_COMPOSE_ENV" \
    --file "$PWD/desktop/compose.yaml" "$@"
}
```

For **rootless Docker**, set `export ROBOZIUM_API_USER=0:0` before starting;
container root maps to your host account. Rootful Docker uses the host UID/GID
above so bind-mounted data remains writable. You may choose another absolute
runtime directory and unused API port before preparing/starting the runtime.
Compose requires an explicit runtime and existing bind sources. Use one API
process per hub directory.

For live mode, supply provider settings in the selected runtime's `.env` or
`.env.encrypt`, following the repository's [credential guidance](../README.md#optional-encrypted-credentials).
Compose loads `.env.encrypt` first and `.env` second; plaintext entries override
matching encrypted-file entries. The empty `--env-file` above prevents automatic
checkout `.env` interpolation. Backend paths and the selected mode/port are set
explicitly in Compose. Keys and decryption remain the Python backend's
responsibility; desktop credential-unlock controls follow in PR 10.

```sh
desktop_compose up --build --wait --wait-timeout 180
curl --fail "http://127.0.0.1:$ROBOZIUM_DESKTOP_API_PORT/ready"
desktop_compose ps
desktop_compose logs --tail=200 api
# Stop this mode's container, retaining its data and built image:
desktop_compose down --remove-orphans
```

The API uses host networking, listens only on `127.0.0.1`, and runs one worker.
Its runtime contains the hub, credentials, local packages, dependency cache,
and logs; Docker stores images separately. The socket and safe-script mounts
are read-only. Host-helper process management remains deferred. Manual
`.artifacts/desktop/manual-data/` and managed `.artifacts/desktop/data/` contain
persistent data, not disposable build output. Live and mock directories remain separate, and shutdown does not delete
either. Restage and rebuild after changing backend source or desktop config.

Backend validation runs separately from the native UI suite:

```sh
npm --prefix desktop run test:backend
npm --prefix desktop run test:backend:docker
npm --prefix desktop run test:backend:lifecycle
xvfb-run -a npm --prefix desktop run test:backend:electron
```

The first command checks staging and Compose with synthetic inputs. The second
builds the real image and checks mock readiness and restart persistence using
a temporary runtime, unused loopback port, and unique Compose project. It removes
only its own test containers/image and temporary data, including after failures.

Lifecycle unit tests cover ownership, errors, cancellation, and process cleanup.
The native backend suite verifies retry, first build/image reuse, close/reopen
persistence, and cancellation against isolated mock Docker resources.
