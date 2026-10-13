# PR 1 — Introduce a minimal Electron application

## Outcome

Running these commands opens a native window showing **Robozium Desktop** and
the application version:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

The application demonstrates Electron's main process, renderer, and preload
bridge through one working interaction. This is PR 1 in the
[desktop roadmap](desktop-roadmap.md).

Build from current `main` in a separate worktree. Preserve the experiment and
the main checkout's README edit.

## Implementation

### Three small entry points

| Part | Responsibility |
| --- | --- |
| Main | Wait for Electron readiness, register the version handler, create one native window, load the local page, and exit when it closes. |
| Preload | Expose `window.robozium.getVersion(): Promise<string>` using `contextBridge`. |
| Renderer | Request the version and display it using ordinary DOM APIs. Display a readable error if the request fails. |

Use the IPC channel `desktop:version`; main returns `app.getVersion()`. Define
the renderer-facing TypeScript interface once. Keep the channel-specific handler
explicit.

The page contains a title and version, with minimal local CSS and system fonts.
Use a standard framed, resizable window. Load the bundled HTML using `loadFile`;
resolve assets relative to the application files so launching from another
working directory works.

### Build and dependencies

- Create an independent `desktop` npm package with exact Electron `44.7.0` and
  Playwright `1.59.1` pins, matching the experiment and existing browser tests.
- Use the repository's resolved TypeScript and ESLint versions, with an ordinary
  TypeScript ESLint configuration.
- Compile main and preload to CommonJS; compile the renderer for the browser.
  Use separate TypeScript configurations to keep Node globals out of renderer
  type checking.
- Keep preload self-contained, with only Electron runtime imports and erased
  type imports. Sandboxed preload cannot load arbitrary sibling CommonJS
  modules. [Electron sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- Provide `build`, `start`, `lint`, `typecheck`, and `test:electron` scripts.
  `start` and `test:electron` build first.
- Ignore compiled output, dependencies, and test artifacts. Do not add a
  bundler or packaging tool.

### Lifecycle and security

- Explicitly enable sandboxing and context isolation; disable Node integration.
- Permit the version request only from the expected window's main frame at the
  exact bundled document URL. Do not authorize all `file:` documents by origin.
- Expose only `getVersion`; keep raw IPC and Electron objects private.
- Block renderer navigation, redirects, popups, and webviews. Deny permission
  requests.
- Apply a CSP permitting the bundled scripts and styles while blocking
  connections, frames, forms, and remote resources.
- On startup failure, report the error and exit unsuccessfully. Closing the
  window must terminate the application.
- Keep the scaffold's Chromium profile under its own ignored artifact directory,
  separate from the experiment. Tests supply a temporary profile through the
  existing `ROBOZIUM_DESKTOP_TEST_DATA` convention.

## Tests and CI

Use a small native suite through
[Playwright's Electron support](https://playwright.dev/docs/api/class-electron),
with temporary profiles, one worker, no retries, bounded waits, and unconditional
cleanup.

Cover these behaviors:

1. Launch from outside the package directory; verify the title and version
   returned by main.
2. Confirm `require`, Node's `process`, and raw IPC are unavailable in the page.
3. Attempt the version operation from another window using the same preload;
   verify rejection.
4. Attempt navigation and a popup; verify the original page remains and no
   additional application window opens.
5. Close the native window, await process exit, and reopen successfully.
6. Fail on unexpected renderer errors; retain diagnostics on failure.

Add desktop lint, type checking, and build verification to **CI**. Add a Linux
**Electron scaffold** job to **Full E2E**, running under Xvfb with Chromium
sandboxing enabled. Include the job in both the aggregate dependency list and
its explicit required-job set.

Retain all existing jobs and assertions. A failed, cancelled, missing, or skipped
desktop job must fail Full E2E.

## Documentation and review

The desktop README should explain:

- Electron supplies Chromium for the UI and Node.js for main.
- Preload runs in an isolated renderer context; it is not another process.
- How to run the scaffold and inspect the renderer with DevTools.
- How this exact request travels through the application:

```text
Renderer calls getVersion()
    → preload invokes desktop:version
    → main validates the sender
    → main returns app.getVersion()
    → renderer displays the result
```

Include a brief file walkthrough, validation commands, and a note that Docker
integration arrives later. Add the relevant testing documentation and a short
Unreleased changelog entry.

Keep production code around 150–250 lines, with tests and configuration reviewed
separately. Exclude Docker management, React/Next.js integration, shared UI
refactoring, saved window preferences, single-instance management, splash
animation, and installers.

Before PR handoff, run applicable local checks and monitor **every required CI
check, including Full E2E, on the latest commit until green**. The PR description
should explain the three responsibilities and provide the two-command
demonstration above.
