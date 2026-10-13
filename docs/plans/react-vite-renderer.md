# PR 2 — Add the independent React and Vite renderer

## Outcome

The existing Electron name/version example is rendered with React and built by
Vite. These commands still open the same small native application:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

This is the next implementation PR in the
[desktop roadmap](desktop-roadmap.md). It follows the Electron scaffold and
establishes the desktop frontend's own build before copying any HUD components.
All application changes stay within `desktop/`; CI and documentation may change
to verify and explain them. Nothing imports or installs the browser application.

## The responsibility being introduced

React owns the rendered page. Vite transforms its TypeScript, JSX, CSS, and assets
into production files. Electron main still owns the native window, and preload
still exposes only `getVersion()`.

```text
React source → Vite build → bundled HTML, JavaScript, and CSS
                                      ↓
                    Electron's local application protocol
                                      ↓
                     sandboxed Chromium renderer
                                      ↓
              existing getVersion bridge → main
```

There is no Next.js dependency, BFF, or frontend HTTP server. For this PR,
development uses the same build-and-launch path as the native tests. A hot-reload
server and its separate URL/permission policy are not required for this step.

## Files and build

- Keep main, preload, and the bridge type under `desktop/src/`. Compile main and
  preload to CommonJS with the existing TypeScript configuration.
- Put the React entry and small application component under
  `desktop/renderer/src/`, beside the existing renderer HTML and CSS. Remove the
  superseded DOM-based `desktop/src/renderer.ts` after the React equivalent works.
- Add a small `desktop/vite.config.mts`. Keep the Electron package's CommonJS
  entry unchanged. Vite emits only into `desktop/dist/renderer/`; its cleanup
  must not delete `dist/main.js` or `dist/preload.js`.
- Add exact compatible React, React DOM, Vite, React plugin, and type dependency
  pins to the desktop package and lockfile. Use the browser's React version if
  compatible, but install it independently in desktop. Do not change the browser
  lockfile or introduce a workspace/shared package for this step.
- Preserve separate Node and browser type configurations. The renderer enables
  JSX and includes the existing bridge declaration without gaining Node globals.
  Type-check the Vite configuration and tests too. Vite transpiles TypeScript;
  retain a separate type check and make the build fail on type errors.
  [Vite TypeScript support](https://vite.dev/guide/features#typescript)
- Keep the existing `build`, `start`, `lint`, `typecheck`, and `test:electron`
  interface. Start and native tests build first. Use the current lint/test tools;
  add only the React lint rules needed by the new component, not a second suite
  that duplicates native behavior checks.

Vite's production output is static assets, not a server to supervise.
[Vite production builds](https://vite.dev/guide/build)

## Loading the built page

Use a fixed local document URL such as `robozium://app/index.html`. Register the
scheme as standard and secure before Electron readiness, then register its
handler before loading the window. Use the stable `protocol.handle` API with
only the privileges required for bundled resources. Do not enable CSP bypass or
use the experimental protocol source API.
[Electron protocol registration](https://www.electronjs.org/docs/latest/api/protocol)

Serve only files emitted into the renderer build directory. Restrict the host
and methods, handle missing files explicitly, and prevent malformed or encoded
paths and symlinks from exposing files outside that directory. Do not serve
source files, profiles, credentials, main/preload output, or arbitrary paths.
Resolve files relative to the application, never the shell's working directory.
Keep the handler small; use a narrowly scoped helper only if that makes its
validation easier to review and test.

The custom URL is an in-process Electron resource handler. It does not open a
network listener. Register no backend proxy or catch-all navigation fallback.

## Preserve the existing boundaries

- Keep sandboxing and context isolation enabled and Node integration disabled.
- Keep preload self-contained with its erased type import and one named method.
  Do not bundle Electron APIs into the React renderer or expose generic IPC.
- Update the main handler's expected document URL. Continue validating the
  specific window, main frame, and exact document before answering the request.
- Retain navigation, popup, webview, and permission restrictions. Keep the CSP
  limited to bundled scripts/styles; do not permit remote connections, inline
  scripts, or eval to make the build work.
- Preserve the isolated Chromium profile, startup failure reporting, native
  close behavior, and process cleanup in tests.

## React behavior

The component initially shows the existing loading message, requests the version
through `window.robozium.getVersion()`, and displays the result. A rejected
request shows the same readable alert as PR 1. Preserve the heading, status and
alert semantics, and minimal appearance so this PR teaches the renderer build
rather than changing the design.

Keep component state local. Add no router, global store, API client, HUD code,
platform abstraction, or new preload capability.

## Acceptance and validation

Retain all six existing native scenarios, updating their expected document URL:
version and renderer isolation; rejection from another window; rejection from
another document; readable request failure; blocked navigation/popups; and
native close/reopen with the same test profile.

Add focused coverage for the new resource handler: the real built JavaScript and
CSS load, unknown hosts/files and unsupported methods fail, and traversal or
encoded-path requests cannot retrieve a harmless fixture outside the renderer
directory. Keep sender validation tests separate from resource-serving tests.
Verify launch from outside the checkout as before and retain diagnostics for
build/load failures.

Use the dedicated native CI job to install, build, and test desktop from a clean
checkout without `web/` or its dependencies. Keep browser CI on the full checkout
so both applications remain independently verified. Do not change or weaken
the Full E2E aggregate, sandbox configuration, retries, or cleanup guarantees.

Local acceptance commands:

```sh
npm --prefix desktop ci
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run build
xvfb-run -a npm --prefix desktop run test:electron
git diff --check
```

Update the desktop walkthrough and testing documentation, and add a brief
Unreleased entry describing the renderer change. Explain the build output and
local protocol in the PR, with generated lockfile changes identified separately.
Target 200–400 production-code lines; split the resource-loading preparation into
its own runnable PR if the combined implementation exceeds the review limit.
All required CI, including browser regressions and Full E2E, must pass on the
latest commit before handoff.

## Deferred work

HUD/component copying begins with PR 3. Docker configuration and lifecycle,
direct backend access, native privileges, application features, packaging, and
shared-code consolidation remain in their own roadmap steps. PR 2 makes no
changes to browser source, browser behavior, or the Python backend.
