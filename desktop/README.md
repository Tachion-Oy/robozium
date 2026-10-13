# Electron renderer

This small Robozium desktop application opens a native window displaying the
application name and version with React. It runs independently of
Docker and the browser application; Docker integration comes later in the
[desktop roadmap](../docs/plans/desktop-roadmap.md).

## Run on Linux

Use Node.js 22.12 or newer and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Installation downloads the pinned Electron binary using its `install-electron`
command. The start command checks types, compiles main/preload, builds the page
with Vite, and launches Electron. Close the native window to exit. The scaffold
stores Chromium's profile in the ignored `.artifacts/desktop/scaffold/` directory.
It does not use the experiment's profile,
hub data, or credentials.

Electron bundles Chromium and Node.js. Node.js installed on your computer runs
the development tools; Electron supplies the runtime used by the application.

## The three parts

| File | Runs where | Responsibility |
| --- | --- | --- |
| `src/main.ts` | Main process, with Node.js and Electron APIs | Own the native window and answer the version request |
| `src/preload.ts` | Isolated context inside the renderer process | Expose one named operation to the page |
| `renderer/src/App.tsx` | Chromium page, without Node.js access | Request the version and render it with React |

Main starts first. After Electron is ready, it registers a handler for bundled
resources, creates a `BrowserWindow`, and loads `robozium://app/index.html`.
Before the page's script runs, Electron executes preload.
Preload is a script in the renderer process, not a third process.

The page cannot import Electron or use Node.js. It can call the small API that
preload exposes through `contextBridge`. This lets the UI ask main to perform a
specific operation without giving the page main's privileges.

## Follow the version request

```text
App.tsx: window.robozium.getVersion()
    → preload.ts: ipcRenderer.invoke("desktop:version")
    → main.ts: ipcMain.handle("desktop:version", ...)
    → validate the window, frame, and document URL
    → return app.getVersion()
    → App.tsx: update React state and display the returned version
```

IPC means inter-process communication. Electron transports the request and its
response between renderer and main. `getVersion()` returns a promise because
that communication is asynchronous. `src/bridge.d.ts` defines the API's types;
it emits no JavaScript.

The version comes from this package's `package.json`. The renderer has no
filesystem access and does not read that file itself. The preload exposes neither
raw IPC nor arbitrary commands.

Main and preload compile to CommonJS with Node/Electron types. The renderer is
checked separately with browser types, without Node globals. The generated
files live in ignored `dist/`. Sandboxed preload only imports Electron at runtime;
its bridge import is a TypeScript type and disappears during compilation.

## What React and Vite add

React renders the page from local component state. The component initially shows
“Loading version…”, requests the version through preload, then displays the
result or a readable error. It introduces no new native capability.

Vite is a build tool. `vite.config.mts` gives it the renderer's HTML entry and the
React plugin; it turns TypeScript, JSX, CSS, and dependencies into static files:

```text
src/main.ts, src/preload.ts → TypeScript → dist/main.js, dist/preload.js
renderer/index.html + renderer/src/ → Vite → dist/renderer/index.html + assets/
```

Vite clears only its renderer output directory, preserving main and preload.
It does not perform type checking, so the build runs TypeScript checks first.
There is no frontend server to start or supervise. During development, close the
app and run `npm --prefix desktop start` again after changes.

`src/renderer-protocol.ts` maps the fixed local URL to the renderer build.
Electron handles it inside the app without opening a network port. The standard,
secure scheme lets browser module scripts and relative asset URLs work normally.
The handler accepts only GET requests for host `app`, checks decoded paths and
resolved symlinks, and serves regular files inside the renderer build directory.
Unknown resources fail rather than falling back to the main page. IPC separately
checks the exact document, frame, and window before answering version requests.

The browser retains Next.js and its BFF under `web/`. Desktop builds with its own
dependencies and never imports that application. UI copying begins in the next
roadmap step; shared-code extraction follows a complete working desktop version.

## Inspect and validate

Press Ctrl+Shift+I in the window to open Chromium DevTools. In its console,
`await window.robozium.getVersion()` returns the version, while `typeof require`
and `typeof process` return `"undefined"`. Main-process errors appear in the
terminal that launched Electron.

```sh
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run build
npm --prefix desktop run test:electron
```

On a Linux machine without a display, use
`xvfb-run -a npm --prefix desktop run test:electron`. The tests use temporary
profiles through `ROBOZIUM_DESKTOP_TEST_DATA`, close their processes, and remove
only those temporary directories. Reports and Electron logs are retained under
`desktop/playwright-report/` and `desktop/test-results/`. The native CI job checks
out only desktop and root files, so it cannot depend on browser source files.

For failures before Electron finishes launching, use:

```sh
DEBUG=pw:browser xvfb-run -a npm --prefix desktop run test:electron
```

Playwright captures native stdout/stderr from process creation. The per-test log
starts only after launch succeeds, so CI also saves the full command output to
`.artifacts/desktop/electron-launch.log` and uploads it on failure.

Both application and tests keep Chromium sandboxing enabled. CI configures
Electron's sandbox helper on its disposable Linux runner. A local sandbox error
requires correcting the host's sandbox setup; do not add `--no-sandbox` to the
application launch command.

Read Electron's [process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
and [sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox)
alongside this small example. See also Vite's
[production build guide](https://vite.dev/guide/build) and Electron's
[protocol API](https://www.electronjs.org/docs/latest/api/protocol).
The detailed acceptance criteria are in the
[React and Vite plan](../docs/plans/react-vite-renderer.md).
