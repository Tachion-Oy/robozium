# Robozium

The Electron app is under development. React connects directly to the Python
API for projects, capabilities, default model selection, and live runs. In Runs
Overview, **Launch** a project or create one with **New Project** to watch
incremental output, messages, script output, prompts, and completion in Current
Run, answer its prompts, **Interrupt** the working agent or **Cancel** the run.
A run that completes, fails, is cancelled or goes missing returns to Runs
Overview. Light/Dark switches the theme, which is kept for the next launch
along with a matching window background. The window frame, header, overview,
capability selector and run view use the accepted experiment's stylesheets and
markup; credentials follow in a later
[roadmap](../docs/plans/desktop-roadmap.md) step.

## Install on Linux

Build a Debian package from a checkout (Node.js 22.12 or newer and npm), then
install it:

```sh
npm --prefix desktop ci
npm --prefix desktop run package:linux
sudo apt install ./desktop/release/robozium-desktop_*_amd64.deb
```

Start **Robozium** from the application menu, or run `robozium` (add `--mock`
for the credential-free mock backend). Docker Engine with Compose v2.24 or newer
is required at runtime; the first start builds the backend image, which needs
internet access and can take several minutes.

The installed app keeps everything in `~/.config/Robozium/` (under
`$XDG_CONFIG_HOME` when that is set): settings, window
size and theme, and per mode (`live/`, `mock/`) the hub, logs and saved
environment, including `.env.encrypt`. Add provider keys once in
**Environment**; they survive updates and reinstalls. Install a newer build the
same way. `sudo apt remove robozium-desktop` removes the app and keeps that
folder; delete it to remove your data. The installed app and a checkout's
`npm --prefix desktop start` both use port 18001 in live mode, so close one
before starting the other, or set `ROBOZIUM_DESKTOP_API_PORT` for the checkout.

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

### Live testing from a worktree

Live mode reads provider keys from `<profile>/live/.env`. To try real model
output from any worktree with one key, keep a development profile outside every
checkout, so coding agents working in the checkout cannot read the key:

```sh
mkdir -p ~/.local/share/robozium-desktop-dev/live
printf 'OPENROUTER_API_KEY=...\n' > ~/.local/share/robozium-desktop-dev/live/.env
chmod 600 ~/.local/share/robozium-desktop-dev/live/.env
ROBOZIUM_DESKTOP_TEST_DATA=~/.local/share/robozium-desktop-dev npm --prefix desktop start
```

The profile, its projects and its API image (port 18001) are shared by every
worktree started this way. To keep the key encrypted instead, put an existing
`.env.encrypt` in the profile's `live/` folder in place of `.env`, and unlock it
from the header's **Secrets locked** menu after the app starts:

```sh
cp /path/to/.env.encrypt ~/.local/share/robozium-desktop-dev/live/.env.encrypt
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
after the renderer connects. When the runtime has a `.env.encrypt`, the header's
**Secrets locked** menu unlocks it with its password, and **Remove secrets**
locks it again; the menu is hidden when there are no encrypted secrets. The
password goes only into the unlock request. A launch or reply refused because
secrets are locked says so and points to the menu, which then shows the locked
state.

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
through the model selector, theme button, and view selector. Open a selector with
a click, Enter, or Space; the selected option receives focus, arrows move between
options, and Enter or a click chooses. Escape returns focus to the trigger, and
clicking outside dismisses the menu without changing the choice. Only one menu
opens at a time. View choices survive theme changes and reset on reload. Connected
model choices change the displayed default only after backend acknowledgement.
Failures retain the last confirmed choice and show an alert; choosing the model
again resubmits it. Opening the selector after a failure, or with an empty
catalogue, reads the current backend state. Connection recovery reloads the model
catalogue and selection without replaying writes or resetting drafts and local
project selection.
Preview model choices stay local and reset on reload.

Connected Runs Overview lists every project with its backend status (running,
waiting, cancelling, syncing or dormant) and start time. The list polls every
three seconds while the overview is visible, and every 250ms while a
cancellation is settling; a failed read keeps the last rows. Rows survive
leaving the overview.

- Clicking a project with an active run opens that run; the current run's row
  reads **Return to** its project. Clicking a dormant project, or **Tools**,
  opens the capability selector for it.
- **Launch** starts a dormant project with its saved capabilities.
- **Cancel** stops a running project's work and shows **Cancelling** until a
  listing reports it dormant. **Delete** asks **Confirm?** before removing a
  dormant project. Refused or failed requests show an alert and keep the row.
- **New Project** opens the capability selector with a **Project name** field.

The capability selector lists fixed **Defaults** and **Selectable** tools and
skills, restoring the project's saved choices. **Launch** saves the choices and
starts the run; **Cancel** or Escape returns to the overview. A load failure
shows an inline alert with **Retry**. Launch and the selector controls stay
disabled while a launch, a model change or a reconnection is pending.

A launch creates the project if needed, reads the capability catalogue and the
project's saved choices when none are given, saves the resolved selection, then
creates the run with it and the acknowledged default model; later model changes
affect future runs. Each step has a ten-second deadline. A created project is
remembered, so launching again from the selector does not create it twice, and
no write is retried automatically. A failure shows a **Launch failed** alert (or
**Secrets locked** when the backend reports locked credentials) and keeps the
selector draft. A timeout may still have prepared a backend run; check the
backend before trying again. Launching another project replaces the local
subscription without cancelling the previous backend run. The project label
always identifies the captured run.

Action notifications appear as top-centre toasts over the HUD in both themes.
Errors are announced as alerts; warnings and successes are polite status messages.
Each toast has **Dismiss**, expires after five seconds, and pauses while hovered.
A repeated title replaces its earlier toast. Connection, model and run errors
that need Retry remain in the persistent notices row.

Opening the event stream starts the prepared run. A snapshot is read immediately,
then every two seconds after the previous read settles, with ten-second deadlines.
Snapshots and events merge by sequence/message identity. As in the reference,
reads recover quietly: a closed or failed stream takes a fresh snapshot and
reconnects after 0.5, 1, 2 and then 4 seconds until a frame arrives, and failed
snapshot reads keep polling. Only a failure that trying again cannot fix, such
as invalid run data or a refused stream, is reported; **Retry output** then
reconnects the known run ID without creating another run. Errors preserve output
and drafts. Completed, failed, cancelled and unknown runs stop polling and
return to Runs Overview. Writes are never retried. Restoring the run after the
app reopens is the next roadmap step.

In standalone preview, the overview lists one local `preview` project whose
**Launch** opens the latest local mock message above
an empty reply editor. Shift+Enter inserts a newline. When the run awaits input,
Enter or **Send** sends the reply once; Send stays disabled while the agent
works. An acknowledged reply clears the draft only if it was not edited while
sending; a rejection, refusal or timeout shows **Reply failed**, keeps the draft
and is never repeated automatically. An answered prompt cannot reappear from a
late snapshot, and opening another run abandons a reply still in flight. The arrow buttons in the left rail move the
divider between message-expanded, equal, and reply-expanded positions. At each
limit, the unavailable direction is disabled. Messages and long drafts scroll
inside their own panels. Divider changes animate over 220ms, or move immediately
when reduced motion is enabled.

The footer's four history arrows select the first, previous, next, or latest
message without wrapping. New output follows the latest message unless you are
reading older history. An active prompt stays current even when a background
notification arrives afterward; the latest arrow returns to that prompt from a
pinned history entry. While the agent works without visible output, after
launch, an accepted reply or a provider retry, the panel shows *Agent is
working...* in the streaming style; earlier messages stay reachable. Provider
retries discard abandoned partial text. Ordinary agent-message completion, or an
interruption, keeps its last progress visible in the streaming style until new
output or a prompt replaces it. Live text scrolls downward; selecting another entry resets
its scroll. At either end, unavailable directions are disabled. Empty history
disables all arrows. The center mark shows whether the agent is working or
awaiting input; assistive technology also reads the run status. Preview retains
three local messages and its static awaiting-input mark; its replies are not
sent and its Cancel and Interrupt stay disabled. Record remains disabled.

Connected, **Interrupt** is available while the agent works without a prompt,
from the moment a reply is accepted. It is sent once and pulses, under its own
label, until the agent asks or stops; a refusal or failure shows **Interrupt
failed** and offers it again. A pending **Cancel** pulses the same way. **Cancel**
uses the same per-project cancellation as the overview row, so the two never
send a second request; a refusal or failure shows **Cancellation failed**.

The run screen uses the experiment's markup and stylesheets. Agent messages and
prompts render as sanitized Markdown; live text and script output stay literal.
Links render but do not open yet: opening files and external pages needs a
native privilege that arrives as its own roadmap item.

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

**Clear reply** empties the draft. **Copy user reply** and **Copy agent
output** copy the exact text, including whitespace and newlines; agent output is
copied as its Markdown source. Clear and Copy user reply are disabled only for
an empty draft. Copy success shows a checkmark for two seconds and renames the
button for assistive technology; selecting another message clears it. Copy
failure shows an alert above the run and allows retry. Cancel stays leftmost and
Send rightmost. When the actions do not all fit beside the centered history
controls, all of them move to one row beneath; there, labels truncate with an
ellipsis instead of wrapping.

Switch views using the header, or use the current run's row in Runs Overview. The
draft, selected message, and divider position survive view, model, theme,
window-size, and zoom changes. Reloading or restarting resets the desktop to
Runs Overview with no local session; it does not recover an existing run yet.
**Dependencies** lists the backend's dependency monitor records: status, ID,
redacted metadata, check time and failure reason, sortable by status or ID.
**Check Now** probes every dependency again (up to about 20 seconds), and an
unavailable dependency's diagnostic can be copied. **Restart backend** restarts
this installation's API container; **Recreate backend** recreates it from the
same image so it reads `.env` again. Both keep mounted data, check container
ownership first, and run one at a time; the HUD reconnects when they finish.
Standalone preview shows a placeholder, as it has no backend. Divider controls remain visible but disabled outside Current Run.

**Environment** lists the runtime's saved settings and secrets, with the
variables that the application and imported tools need. **Add variable** and
**Change** open an inline editor; **Secret** stores the value encrypted, and
stored secrets are shown masked and can be kept or replaced. Saving replaces the
saved file once: secrets need an encryption password, confirmed the first time.
A refused save, for example after the settings changed elsewhere, keeps the edits.
**Reset environment** asks first, then deletes the saved settings and secrets.
Editing is unavailable while runs or background work are active. Unsaved edits
survive leaving the screen.

**Browse folder** imports a tool or skill folder (a Python package with an
`env.example` or `.env.example`); each file is uploaded with its path inside the
folder, its variables join the list, and it is available after a restart. Saved
settings, imports and resets apply after **Restart app**, which stops the
backend and starts the app again on Runs Overview; encrypted secrets are then
unlocked from **Secrets locked**. With
unsaved edits, Restart app first asks in the HUD whether to discard them.

Both selectors reserve stable widths for their labels, so changing the model or
view keeps the other header controls in place. They shrink with the window;
truncated labels retain their full hover tooltips.

Use Ctrl++ or Ctrl+= to zoom in, Ctrl+- to zoom out, and Ctrl+0 to reset
(Command on macOS). Zoom moves in 10% steps between 50% and 300%. The keypad +
and - keys also work.

The window opens at 1260×780, or at the size it had when the app last closed,
within 640×420 and 90% of the screen. Zoom is remembered too. Opening the
message log grows the window just enough to show both panes, side by side when
the screen is wide enough and stacked otherwise; closing it restores the
earlier size unless you resized the window meanwhile. Launching the app again
brings the open window to the front.

## Tuning the light theme

The light theme's button, selector and runs-table colours are tuned in one
place: the **Light theme tuning** block at the top of
`renderer/src/ui/styles/light-theme.css`. Each `--tune-*` knob scales how much
accent colour is mixed in at that kind of spot (fill, hover fill, edge, text,
glow, sheen, shadow, neutral line); `1` is the current look. The base colours
those knobs scale are in the block below it.

To try values live, run `npm --prefix desktop run start:preview`, switch to
Light, press Ctrl+Shift+I and edit the knobs on `:root[data-theme="light"]`
in the Styles pane, then copy the values into the file. After editing the file,
`npm --prefix desktop run build` and Ctrl+R reload the window.

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
  Folders, owners and dependency rules are described in
  [`renderer/src/ARCHITECTURE.md`](renderer/src/ARCHITECTURE.md).
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
- `renderer/src/projects/useProjectLaunch.ts` owns the launch command: project
  creation, capability resolution and saving, and run creation.
  `renderer/src/session/useRunSession.ts` owns the displayed run's subscription.
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
responsibility; the desktop only sends the unlock password to the backend.

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
