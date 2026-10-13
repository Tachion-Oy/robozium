# Electron scaffold

This is the first step toward the Robozium desktop application. It opens a native
window displaying the application name and version. It runs independently of
Docker and the browser application; Docker integration comes later in the
[desktop roadmap](../docs/plans/desktop-roadmap.md).

## Run on Linux

Use Node.js 22.12 or newer and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Installation downloads the pinned Electron binary using its `install-electron`
command. The start command compiles TypeScript and launches Electron. Close the native
window to exit. The scaffold stores Chromium's profile in the ignored
`.artifacts/desktop/scaffold/` directory. It does not use the experiment's profile,
hub data, or credentials.

Electron bundles Chromium and Node.js. Node.js installed on your computer runs
the development tools; Electron supplies the runtime used by the application.

## The three parts

| File | Runs where | Responsibility |
| --- | --- | --- |
| `src/main.ts` | Main process, with Node.js and Electron APIs | Own the native window and answer the version request |
| `src/preload.ts` | Isolated context inside the renderer process | Expose one named operation to the page |
| `src/renderer.ts` | Chromium page, without Node.js access | Request the version and display it |

Main starts first. After Electron is ready, it creates a `BrowserWindow` and loads
`renderer/index.html`. Before the page's script runs, Electron executes preload.
Preload is a script in the renderer process, not a third process.

The page cannot import Electron or use Node.js. It can call the small API that
preload exposes through `contextBridge`. This lets the UI ask main to perform a
specific operation without giving the page main's privileges.

## Follow the version request

```text
renderer.ts: window.robozium.getVersion()
    → preload.ts: ipcRenderer.invoke("desktop:version")
    → main.ts: ipcMain.handle("desktop:version", ...)
    → validate the window, frame, and document URL
    → return app.getVersion()
    → renderer.ts: display the returned version
```

IPC means inter-process communication. Electron transports the request and its
response between renderer and main. `getVersion()` returns a promise because
that communication is asynchronous. `src/bridge.d.ts` defines the API's types;
it emits no JavaScript.

The version comes from this package's `package.json`. The renderer has no
filesystem access and does not read that file itself. The preload exposes neither
raw IPC nor arbitrary commands.

Main and preload compile to CommonJS with Node/Electron types. The renderer
compiles separately as browser JavaScript, without Node globals. The generated
files live in ignored `dist/`. Sandboxed preload only imports Electron at runtime;
its bridge import is a TypeScript type and disappears during compilation.

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
`desktop/playwright-report/` and `desktop/test-results/`.

Both application and tests keep Chromium sandboxing enabled. CI configures
Electron's sandbox helper on its disposable Linux runner. A local sandbox error
requires correcting the host's sandbox setup; do not add `--no-sandbox` to the
application launch command.

Read Electron's [process model](https://www.electronjs.org/docs/latest/tutorial/process-model)
and [sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox)
alongside this small example. The detailed acceptance criteria are in the
[scaffold plan](../docs/plans/electron-scaffold.md).
