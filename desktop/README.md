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

Build a Debian package from a checkout (Node.js 22.18 or newer and npm), then
install it:

```sh
npm --prefix desktop ci
npm --prefix desktop run package:linux
sudo apt install ./desktop/release/robozium-desktop_*_amd64.deb
```

Start **Robozium** from the application menu, or run `robozium` (add `--mock`
for the credential-free mock backend). apt installs rootless Podman with the
app; the first start builds the backend image, which needs internet access and
can take several minutes.

The Robozium mark is one file, `renderer/public/branding/robozium-mark.svg`.
Replace it with any single-colour SVG that has a `viewBox` (or a width and
height) and rebuild: the HUD and loader indicators and the installed app icon
all follow. Only its shape is used; the colours and glows come from the HUD.

The Robozium mark is one file, `renderer/public/branding/robozium-mark.svg`.
Replace it with any single-colour SVG that has a `viewBox` (or a width and
height) and rebuild: the HUD and loader indicators and the installed app icon
all follow. Only its shape is used; the colours and glows come from the HUD.

Projects live in your hub folder, `~/Robozium-Hub` by default. **Environment →
Hub folder** shows its full path, opens it, and changes it with the folder
picker; a new folder applies after a restart. If the folder goes missing, the
app stops at startup and asks you to reconnect it or choose another, rather than
starting with an empty hub. The app never moves or deletes a hub folder.

The app's own data stays in `~/.config/Robozium/` (under `$XDG_CONFIG_HOME`
when that is set): settings, window size and theme, the recorded hub folder,
and per mode (`live/`, `mock/`) logs and saved environment, including
`.env.encrypt`. Checkouts and test profiles start with a throwaway hub inside
their own data and can choose another folder the same way. Mock mode always keeps
its own throwaway hub, so its fake projects never reach a real one. Add provider keys once in
**Environment**; they survive updates and reinstalls. Install a newer build the
same way. `sudo apt remove robozium-desktop` removes the app and keeps both
folders. The installed app and a checkout's
`npm --prefix desktop start` both use port 18001 in live mode, so close one
before starting the other, or set `ROBOZIUM_DESKTOP_API_PORT` for the checkout.

## Run on Linux

Requires rootless Podman (`sudo apt install podman uidmap catatonit`), Node.js
22.18 or newer, and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Normal startup uses live mode. For a credential-free mock backend:

```sh
npm --prefix desktop start -- --mock
```

### First start in live mode

Without saved settings or a `.env`, a live start locks the HUD: Runs
Overview shows **Start Here** instead of **New Project**, project
rows, the model selector and run controls are disabled, and the view menu leads
only to Environment. **Start Here** opens a guide paged with the message arrows.
Its first step: drop an existing `.env.encrypt` on **Key file** in Environment
and enter its password. Otherwise add a key and choose **Encrypt and save**.
Either way the keys load at once and the HUD unlocks without a restart.

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
`.env.encrypt` in the profile's `live/` folder in place of `.env`, and enter its
password when the app asks for it after starting:

```sh
cp /path/to/.env.encrypt ~/.local/share/robozium-desktop-dev/live/.env.encrypt
```

The start command stages the allowlisted Python source. Main builds the API
image on first launch and waits for readiness. React then checks `/ready` through
its HTTP client before showing the HUD. Meanwhile the startup screen plays the
introduction, then a loading HUD; it fades into the HUD once the
backend is ready and the HUD has drawn beneath it. Reduced motion skips the
introduction. The first build requires internet.
Later launches reuse the image when the staged inputs match its build identifier.
Startup failures show an explanation and **Retry** in a toast over the loading screen. Closing the window cancels
startup, waits for its Podman command to exit, and stops only the installation's
verified API containers. Containers, images, credentials, and host data remain.
A second managed launch using the same profile exits without changing its backend.
The app always uses this machine's own rootless Podman; it ignores
`CONTAINER_HOST` and `CONTAINER_CONNECTION`, so a remote Podman never receives
the hub's mounts.

Managed app data lives in `.artifacts/desktop/data/`, with separate `live/` and
`mock/` runtime directories. The installation identifier in
`backend-installation-id` scopes container ownership. `settings.json` holds
only UI preferences (theme, window size, zoom); the backend is configured by the
repository's `hub.config.py` and the runtime's `.env`.
Defaults are live **18001** and mock **18000**.
Set `ROBOZIUM_DESKTOP_API_PORT` to an unused port to override that mode's port.
Stop the app before changing a port; existing containers with different ownership,
ports, or mounts are rejected. Do not share a hub between managed and manual runs.

Provider configuration belongs in the selected runtime's `.env` or `.env.encrypt`;
see the [credential guidance](../README.md#optional-encrypted-credentials).
Keys and decryption remain in the Python backend. Startup opens the HUD
after the renderer connects. When the runtime's `.env.encrypt` is locked, a
password dialog opens once the startup screen has faded; cancelling it leaves
the HUD usable. A launch or reply while locked opens the dialog again and goes
ahead once unlocked; cancelling shows **Secrets locked**. Every secrets password,
including Environment saves and key files, is typed only in that dialog. The
password goes only into the unlock request.

Once connected, React checks readiness every five seconds with a three-second
timeout. A connection failure stops polling and shows an accessible notice with
**Retry**. The HUD stays mounted, preserving your draft, model/view and history
selection, divider position, and theme. Connection Retry checks the existing API
and resumes polling when ready; it does not rebuild or restart the container.
Backend startup Retry still retries the container setup.

Main supplies the controller's selected loopback address through the trusted
bridge and uses that same address in the bundled page's CSP. Application traffic
uses HTTP/SSE directly. With the desktop API port configured, Python accepts the
exact `robozium://app` origin and selected `127.0.0.1:port` Host, while retaining
originless native CLI/health checks. It rejects other origins/hosts and originless
browser requests carrying Fetch Metadata before invoking endpoints. No credentials or tokens enter the bridge.

Build/start diagnostics append to the mode's `.runtime/logs/container.log`. For
API logs, use `podman logs --tail=200 <container>` with the API container
`robozium-desktop-<installation-id>-<mode>-api`. Ownership failures leave
unrecognized containers alone; inspect the project and mounts before retrying.
Shutdown failures are reported on stderr and exit with a nonzero status.

For UI development without a container, start a backend yourself and give the app
its address. The API accepts the app only when started with
`ROBOZIUM_DESKTOP_API_PORT` set to its port:

```sh
ROBOZIUM_DESKTOP_API_PORT=8000 ROBOZIUM_HUB_ROOT=.runtime/dev-mock-hub \
  ROBOZIUM_LOG_DIR=.runtime/dev-mock-logs \
  uv run uvicorn robozium.api.app:mock_app --factory --reload --host 127.0.0.1 --port 8000
cd desktop && npm run build && npx electron . --backend-url=http://127.0.0.1:8000
```

`--backend-url` takes `http://127.0.0.1:<port>` or `http://localhost:<port>`.
The app then starts no container and leaves the backend's lifecycle and hub
to whoever started it: startup Retry has nothing to retry, **Restart backend**,
**Recreate backend** and opening hub files report that this launch uses a
backend it does not manage, and the hub folder cannot be chosen. **Restart app**
starts the app again with the same address. Such a launch uses the same profile,
and the same single running instance, as an ordinary launch.

Close and restart the app to rebuild after source changes.
`.artifacts/desktop/data/` is persistent user data; `desktop/.stage/` and
`desktop/dist/` are regenerable build outputs.

The app starts in dark mode with Runs Overview selected and loads the backend's
default model. Tab moves
through the model selector, theme button, and view selector. Open a selector with
a click, Enter, or Space; the selected option receives focus, arrows move between
options, and Enter or a click chooses. Escape returns focus to the trigger, and
clicking outside dismisses the menu without changing the choice. Only one menu
opens at a time. View choices survive theme changes and reset on reload. Model
choices change the displayed default only after backend acknowledgement.
Failures retain the last confirmed choice and show an alert; choosing the model
again resubmits it. Opening the selector after a failure, or with an empty
catalogue, reads the current backend state. Connection recovery reloads the model
catalogue and selection without replaying writes or resetting drafts and local
project selection.

Runs Overview lists every project with its backend status (running,
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
**Secrets locked** when the password dialog is cancelled) and keeps the
selector draft. A timeout may still have prepared a backend run; check the
backend before trying again. Launching another project replaces the local
subscription without cancelling the previous backend run. The project label
always identifies the captured run.

Action notifications appear as top-centre toasts over the HUD in both themes.
Errors are announced as alerts; warnings and successes are polite status messages.
Each toast has **Dismiss**, expires after five seconds, and pauses while hovered.
A repeated title replaces its earlier toast. Problems and statuses never take
space in the HUD: a connection loss, a failed read, a model or run error, a
required restart or a confirmation is a toast that stays until it is resolved,
and carries its own actions, such as **Retry**, instead of **Dismiss**.

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

A launched run opens its latest message above an empty reply editor.
Shift+Enter inserts a newline. When the run awaits input,
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
awaiting input; assistive technology also reads the run status.

**Interrupt** is available while the agent works without a prompt,
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
unavailable dependency's diagnostic can be copied. **Environment** ends with one
row of actions: **Save**, **Restart app**, **Restart backend**, **Recreate
backend** and **Reset environment**. **Restart backend** restarts
this installation's API container; **Recreate backend** recreates it from the
same image. Both read `.env` again. Both keep mounted data, check container
ownership first, and run one at a time; the loading screen covers the HUD
until it reconnects. **Restart app** shows it too, until the app closes.
Divider controls remain visible but disabled outside Current Run.

**Environment** lists the runtime's saved settings and secrets, with the
variables that the application needs. **Add variable** and
**Change** open an inline editor; **Secret** stores the value encrypted, and
stored secrets are shown masked and can be kept or replaced. Saving replaces the
saved file once: secrets need an encryption password, confirmed the first time.
A refused save, for example after the settings changed elsewhere, keeps the edits.
**Reset environment** asks first, then deletes the saved settings and secrets.
Editing is unavailable while runs or background work are active. Unsaved edits
survive leaving the screen.

**Key file** adopts an existing `.env.encrypt`, for example from another
install, so keys are never typed again: drop the file on the
row or choose **Browse file**, enter the password it was encrypted with, and
choose **Use key file** (**Replace saved settings** when settings exist). The
backend accepts the file only if that password opens its secrets; a wrong
password shows in the dialog and keeps the file. On a fresh live start the keys load
at once, without a restart; otherwise they apply after **Restart app**.

Saved settings and resets apply after **Restart app**, which stops the
backend and starts the app again on Runs Overview, where the app asks for the
password of encrypted secrets. With
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

## Host services

Some backend tools call a program that runs on your computer rather than in
the container. The safe-scripts tool runs the hub's `readonly/safe-scripts` as you,
with your own files and logins, which the Slack sweep needs. In live mode on
Linux the app starts these programs before the backend and stops them after it.

They need [`uv`](https://docs.astral.sh/uv/) on `PATH` or in `~/.local/bin`. The
app installs their Python packages, pinned by the `host` group in `uv.lock`, into
`<runtime>/.runtime/host-environment`. Each service logs to
`<runtime>/.runtime/logs/<name>.log`. **Dependencies** lists each service with
its state and, when one cannot run, the reason. A service that keeps exiting is
restarted twice and then reported failed. After a crash, the next launch stops
the service the crash left running.

To add a service, declare it under `desktop.hostServices.services` in
`src/backend-layout.json`: its platforms and modes, the program and arguments
from the host environment, its log, and its endpoint. Arguments name hub or
runtime folders by their container path (`{ "hostPath": "/hub" }`), and
`{ "endpoint": "address" }` is the endpoint's host address. Each endpoint type
in `src/host-endpoints.ts` turns its declaration into an address, probes it, and
clears what a crashed service left there. The `unix-socket` type is a socket file
named by an API environment variable; another transport, such as one for macOS,
is another endpoint type, and the layout and supervisor stay as they are.

## Tuning the light theme

The light theme's button, selector and runs-table colours are tuned in one
place: the **Light theme tuning** block at the top of
`renderer/src/ui/styles/light-theme.css`. Each `--tune-*` knob scales how much
accent colour is mixed in at that kind of spot (fill, hover fill, edge, text,
glow, sheen, shadow, neutral line); `1` is the current look. The base colours
those knobs scale are in the block below it.

To try values live, start the app as above, switch to
Light, press Ctrl+Shift+I and edit the knobs on `:root[data-theme="light"]`
in the Styles pane, then copy the values into the file. After editing the file,
`npm --prefix desktop run build` and Ctrl+R reload the window.

## Checks

```sh
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run test:electron
```

On Linux the native test scripts start their own Xvfb display (`sudo apt install
xvfb`), so test windows never appear on your screen.

See the [testing guide](../docs/testing.md#electron-scaffold-checks) for diagnostics
and CI details.

## Code layout

**Hard rule: do not hardcode filesystem locations in application code.** Resolve
paths from configured profile/runtime roots. Define bind-mount paths,
desktop-owned runtime file locations, and the named locations in
`desktop.locations` (profiles, backend resources, settings files, the default
hub folder) in the shared desktop layout configuration, `src/backend-layout.json`.
Use that definition for mount preparation, ownership validation, container
logging, and the container's options. Repeating paths such as `.runtime/local-deps` or
`hub/readonly/safe-scripts` in controller or helper path lists is prohibited.

All desktop code is TypeScript in ES modules. Node runs the main-process
sources, scripts and backend tests directly, so `src`, `scripts` and
`backend-tests` follow three rules that `tsc` enforces: only syntax Node can
strip (no enums, namespaces or constructor parameter properties), `import type`
for type-only imports, and relative imports that name their `.ts` file. The
exception is the sandboxed preload, `src/preload.cts`: Electron requires it to be
CommonJS, so `tsconfig.preload.json` compiles it on its own and Node never runs
it directly. The renderer and Playwright tests are bundled or transpiled by Vite
and Playwright, so their imports omit extensions.

Desktop setup prepares the host folders the container mounts, including the
nested read-only safe-scripts mount. The hub owns its application structure and
files within those mounts; desktop setup must not create or configure internal
directories such as `local/tools` or `local/skills`. The desktop
also owns its installation identity and container log.

- `src/` contains Electron main, preload, and the typed bridge. Main owns
  backend lifecycle. Native clipboard writes use `writeClipboardText(text)`,
  validating the window, main frame, document URL, and string payload. Browser clipboard permissions
  remain denied; the bridge exposes no clipboard-read operation. Backend IPC is
  limited to `getBackendConnection()`, `getBackendStatus()`, `getHostServices()`, and `retryBackend()` with the same trusted
  document checks; it exposes no shell or container command interface.
- `src/backend-controller.ts` coordinates startup, readiness, retry, and shutdown.
- `src/container-engine.ts` describes the backend container independently of the
  engine that runs it, and the operations the controller needs from an engine.
  `src/podman-engine.ts` provides them with rootless Podman on Linux.
- `src/host-command.ts` finds host programs and runs one command, handling its
  output, timeout, and cancellation.
- `src/host-services.ts` starts, supervises, and stops the layout's
  [host services](#host-services); `src/host-endpoints.ts` defines how each
  endpoint type is addressed and probed; `src/host-environment.ts` prepares the
  Python environment they run from.
- `src/backend-profile.ts` exposes `loadOrCreateBackendProfile()`, which reads or
  creates the installation identity and selects the mode's runtime and port.
- `src/backend-layout.json` defines bind mounts and desktop-owned runtime file
  locations, and the backend container's environment and command.
- `src/backend-layout.ts` resolves and prepares that layout's host paths.
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
- `renderer/src/projects/useProjectMutations.ts` owns the launch command (project
  creation, capability resolution and saving, and run creation) beside cancel
  and delete.
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

## Backend diagnostics (Linux)

The app runs the existing Python API in a rootless Podman container, as the user
who starts it. Podman needs no daemon and no privileged group; container root is
your own account, so files the backend writes to the hub stay yours. The API
uses your network, listens only on `127.0.0.1`, and runs one worker. The
container has no capabilities, cannot gain privileges, and never pulls images:
the app builds its own from the staged sources.

`npm --prefix desktop run backend:stage` regenerates `desktop/.stage/backend/`
from an explicit allowlist. It includes locked Python dependencies, the
Dockerfile, and the existing Python application. Symlinks are rejected.
Credentials, private imports, hubs, frontend files, and caches are excluded.
The image retains the existing Linux CLI tools, and its own user is UID/GID 10001.

`src/backend-layout.json` describes the container: its mounts, environment
values, and command. The layout says what the backend needs, not how an engine
provides it; `src/podman-engine.ts` turns it into Podman commands. The app
passes only those values, with the selected mode and port, in
`.runtime/container.env`, readable only by you and removed as soon as the
container starts. At each start the backend reads the runtime's `.env.encrypt`
and then `.env` itself, with plaintext entries overriding matching encrypted
ones; the container's own values always win. Keys and decryption remain the
Python backend's responsibility; the desktop only sends the unlock password to
the backend. A changed `.env` applies after **Restart backend**, **Recreate
backend** or a restart of the app.

Every container the app creates carries labels with its installation and mode,
and every image it builds carries its build label. To see them and the API's own log:

```sh
podman ps --all --filter label=fi.tachion.robozium.desktop.installation
podman logs --tail=200 <container>
podman images --filter label=fi.tachion.robozium.desktop.build
```

The runtime contains the hub, credentials, local packages, dependency cache, and
logs; Podman stores images separately under `~/.local/share/containers`. The
socket and safe-script mounts are read-only. Managed `.artifacts/desktop/data/`
contains persistent data, not disposable build output. Live and mock directories
remain separate, and shutdown deletes neither. Restage after changing backend
source or desktop config; the next start rebuilds the image.

Backend validation runs separately from the native UI suite:

```sh
npm --prefix desktop run test:backend
npm --prefix desktop run test:backend:container
npm --prefix desktop run test:backend:lifecycle
npm --prefix desktop run test:backend:electron
```

The first command checks staging and the layout with synthetic inputs. The
second builds the real image with the app's own controller and checks mock
readiness and persistence across restart and recreate, using a temporary
profile and unused loopback port. It removes only its own test containers and
temporary data, and untags its image so the layers stay as build cache,
including after failures.

Lifecycle unit tests cover ownership, errors, cancellation, and process cleanup.
The native backend suite verifies retry, first build/image reuse, close/reopen
persistence, and cancellation against isolated mock Podman resources.
