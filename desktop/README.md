# Robozium

The Electron app is under development. It currently shows the application name
and version beneath a four-control HUD header after its backend is ready. Start
run in Runs Overview opens a local mock history and editable reply panels. Model
choices remain local; Light/Dark switches the theme, and Secrets unavailable is
disabled. The HUD still uses local fixtures; the API connection follows in PR 6.

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
image on first launch and waits for readiness before showing the HUD. The first
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
Keys and decryption remain in the Python backend. Startup currently opens the
fixture HUD; credential-unlock controls follow in PR 10.

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

The app starts in dark mode with Mock model and Runs Overview selected. Tab moves
through the model selector, theme button, and view selector, skipping Secrets.
Open a selector with a click, Enter, Space, or an arrow key. Use arrows, Home/End,
or type a name prefix to explore choices. Enter, Space, or Tab accepts the
highlighted choice; Escape or clicking the open trigger cancels. Clicking outside
accepts the highlighted choice and dismisses the popup. Only one popup opens at
a time. Model/view choices survive theme changes and reset when the page reloads
or the app restarts.

Select **Start run** in Runs Overview to open **Current Run**. The latest mock message
appears above an empty reply editor. Draft freely: Enter and Shift+Enter insert
newlines; replies are not sent yet. The arrow buttons in the left rail move the
divider between message-expanded, equal, and reply-expanded positions. At each
limit, the unavailable direction is disabled. Messages and long drafts scroll
inside their own panels. Divider changes animate over 220ms, or move immediately
when reduced motion is enabled.

The footer's four history arrows select the first, previous, next, or latest of
three local messages without wrapping. At either end, unavailable directions
are disabled and keyboard focus moves to the nearest reverse arrow. The “A”
mark shows a static awaiting-input state. Cancel, Interrupt, Record, and Send
are disabled previews.

**Clear reply** empties the draft and returns focus to the editor. **Copy reply**
and **Copy agent output** copy the exact displayed text, including whitespace
and newlines. Clear and Copy reply are disabled only for an empty draft. Copy
success shows a green checkmark for two seconds and is announced to assistive
technology; changing the copied content clears that feedback. Copy failure
shows a footer alert and allows retry. These controls appear only in Current
Run and wrap beneath the centered history controls when space is tight.

Switch views using the header, or use **Return to run** in Runs Overview. The
draft, selected message, and divider position survive view, model, theme,
window-size, and zoom changes. Reloading or restarting resets the preview to Runs Overview with no
active run. Dependencies and Environment still display “This view is coming
soon.” Divider controls remain visible but disabled outside Current Run.

Both selectors reserve room for their longest labels, so changing the model or
view keeps the other header controls in place. They shrink with the window;
truncated labels retain their full hover tooltips. API connections, provider
credentials, and environment editing arrive in their later roadmap steps.

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
paths from configured profile/runtime roots. Define runtime subdirectories once
in the authoritative backend layout/configuration and use that definition for
directory creation, mount validation, logging, and Compose integration. This
includes relative locations such as `local/tools`, `.runtime/local-deps`, and
`hub/readonly/safe-scripts`; repeating them in controller or helper path lists
is prohibited.

- `src/` contains Electron main, preload, and the typed bridge. Main owns
  backend lifecycle. Native clipboard writes use `writeClipboardText(text)`,
  validating the window, main frame, document URL, and string payload. Browser clipboard permissions
  remain denied; the bridge exposes no clipboard-read operation. Backend IPC is
  limited to `getBackendStatus()` and `retryBackend()` with the same trusted
  document checks; it exposes no shell or Docker command interface.
- `renderer/src/` contains the React entry point and app state.
- `renderer/src/components/hud/` contains the header, panels, divider, footer, and their CSS.
  Components import the styles they own; the header currently owns its inline
  theme toggle's styling.
- `renderer/src/components/views/` contains Runs Overview, view placeholders, and their CSS.
- `renderer/src/fixtures/` contains local model/view choices and three mock run messages.
- `renderer/src/assets/` contains the bundled Anurati status-mark font.
- `renderer/src/styles/app.css` contains app-wide typography, theme tokens,
  base styles, and the frame.
- `tsconfig.json` supplies Node types and module settings for every file in
  `src/`. Its standard name lets editors discover the same project used by the
  build. The test and Vite configurations extend it.
- `renderer/tsconfig.json` supplies the renderer's browser and Vite asset types
  to both the editor and the command-line type check.
- `tests/` contains native scenarios and screenshot baselines.

Keep new components with their feature and their styles beside them. Add folders
as those features arrive in the desktop roadmap.

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
umask 077
mkdir -p "$ROBOZIUM_DESKTOP_RUNTIME/local/tools" \
  "$ROBOZIUM_DESKTOP_RUNTIME/local/skills" \
  "$ROBOZIUM_DESKTOP_RUNTIME/local/imports" \
  "$ROBOZIUM_DESKTOP_RUNTIME/.runtime/local-deps" \
  "$ROBOZIUM_DESKTOP_RUNTIME/.runtime/logs" \
  "$ROBOZIUM_DESKTOP_RUNTIME/.runtime/host-socket" \
  "$ROBOZIUM_DESKTOP_RUNTIME/hub/readonly/safe-scripts"
: > "$ROBOZIUM_DESKTOP_RUNTIME/.runtime/compose.env"
desktop_compose() {
  docker compose --project-name "robozium-desktop-manual-$ROBOZIUM_MODE" \
    --env-file "$ROBOZIUM_DESKTOP_RUNTIME/.runtime/compose.env" \
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
