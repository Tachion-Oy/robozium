# Electron first: eleven small, understandable PRs

## Approach

Start with a working Electron scaffold. Build outward from something you can run,
inspect, and understand.

Preserve the experiment's desktop appearance, the existing browser experience,
and Docker as the application runtime. Share one frontend and backend
implementation. Finish with a tested Linux `.deb`.

## PR 1 — Introduce the Electron scaffold

**Result:** `npm --prefix desktop start` opens a native window containing a
bundled page showing “Robozium Desktop” and its application version.

Keep the implementation small and explicit:

- **Main:** creates the window, loads the bundled page, handles application exit,
  and answers a version request.
- **Renderer:** ordinary HTML, CSS, and TypeScript displaying the page.
- **Preload:** exposes one function, `getVersion()`, which the renderer calls to
  request the version from main.

Preload runs inside the renderer in an isolated context; it is not a third
process. These are the core responsibilities described in Electron's
[process model](https://www.electronjs.org/docs/latest/tutorial/process-model).

Use strict TypeScript compiled with `tsc`, a pinned Electron dependency, and a
lockfile. Load the local page with `loadFile`. Enable sandboxing and context
isolation, disable Node integration, restrict navigation/popups, apply a
local-content CSP, and validate the IPC sender.

The README explains this exact call:

```text
Page → preload.getVersion() → IPC → main → application version → page
```

Include a short file walkthrough and instructions for running and debugging it.
Keep technical explanations in documentation; the window itself contains only
the application title and version.

**Acceptance:** a Linux native CI test launches the window, verifies the version,
confirms the renderer cannot access Node APIs, and closes the application
successfully. Add this job to the required Full E2E gate immediately.

This PR introduces no Docker management, Next.js integration, shared-component
refactoring, or packaging. See the [detailed scaffold plan](electron-scaffold.md).

## Remaining PRs

Each builds on the preceding result and teaches one additional responsibility.

| PR | Change | Acceptance |
| --- | --- | --- |
| **2. Separate HUD content from browser placement** | Extract reusable HUD content and state. Keep floating placement, resizing, dismissal, and terminal background in the browser layout. | Existing browser behavior, appearance, navigation, and reply tests remain unchanged. |
| **3. Share introduction and loading presentation** | Extract reusable React presentation for the terminal introduction, backdrop, and loading frame. Preserve existing assets, themes, and timing. | Browser introduction checks pass; shared presentation imports neither Next.js routing nor desktop runtime code. |
| **4. Add the desktop frontend layout** | Add explicit browser/desktop layout selection to the existing Next.js app. Reproduce the full-window HUD, opaque panels, spacing, selectors, and responsive footer. | Both layouts work from the same build. Verify themes, narrow windows, zoom, focus, and stable controls. |
| **5. Consolidate Docker configuration** | Reuse the base Compose services with a small desktop override for existing differences in paths, ports, image identifiers, and layout selection. | Configuration checks verify mounts, credential paths, loopback listeners, health checks, and one API worker. Existing launcher defaults remain intact. |
| **6. Introduce Docker lifecycle management** | Add allowlisted source staging and a focused controller for Docker discovery, image reuse/building, startup, readiness, cancellation, and shutdown. | Test real mock startup/shutdown plus missing Docker, ownership mismatch, occupied ports, readiness failure, and cleanup without deleting data. |
| **7. Connect Electron to the application** | Wire the scaffold to the controller and shared frontend. Evolve the local page into a loading/error/retry screen. Add single-instance behavior, saved size/theme/zoom, and reliable close/reopen. | Complete a mock run in Electron; verify startup cancellation, duplicate launch, persistence, security boundaries, and owned-service cleanup. |
| **8. Restore the accepted startup sequence** | Bundle shared presentation with Vite and serve it through a restricted custom protocol. Add the offline introduction, translucent loading HUD, and painted-application handoff. | Test fast/slow startup, failure/retry, closing during startup, reduced motion, and both themes. |
| **9. Add the docked message log** | Reuse terminal rendering and the existing run session. Preserve tuned shadows, stacked layout, temporary window expansion, and restoration behavior. | Preserve drafts, focus, and recording. Avoid duplicate session subscriptions; unmount the transcript when closed. |
| **10. Add desktop restart controls** | Connect Environment's app restart and Dependencies' restart/recreation operations through named preload methods. | Verify unsaved-edit confirmation, imported-tool activation, readiness before reveal, introduction replay, and web-container preservation during API recreation. |
| **11. Package and validate Linux installation** | Build the `.deb` with Electron Builder using allowlisted resources and locked source inputs. Document prerequisites, installation, first launch, diagnostics, and recovery. | Install and exercise the package in disposable Linux CI outside the checkout, without host Node/npm/Python. |

## Sharing and review rules

- Keep one frontend under `web` with explicit browser and desktop layouts. Share
  API routes, HTTP/SSE handling, session state, screens, HUD content, terminal
  rendering, assets, and common styling.
- Select the layout server-side using `ROBOZIUM_UI=browser|desktop`, defaulting to
  browser. Layout selection grants no native privileges.
- Shared components receive specific callbacks or slots. Desktop bridge access
  stays in desktop integration code.
- Keep Electron responsibilities under `desktop`. Grow the typed preload
  contract only when a feature consumes it.
- Retain Next.js and the existing API proxy. Use Vite only for the offline
  startup entry.
- Keep the existing two npm packages; introduce no generic platform framework
  or copied frontend.
- Build onto `main`. Preserve the experiment as the visual reference and keep
  unrelated existing branches and the README edit separate.
- Target **200–400 changed production-code lines per PR**. Split changes
  exceeding roughly 500; identify mechanical moves, lockfiles, tests, and images
  separately.
- Every PR includes its tests, relevant documentation, a runnable demonstration,
  and an explanation of the newly introduced responsibility.

## Validation and defaults

Preserve the six existing Full E2E jobs and add native coverage from PR 1 onward.
Run applicable Python, frontend, and desktop checks. Every submitted PR must
have green required checks on its latest commit before handoff.

Use focused visual checks for both themes, startup, idle/run HUDs, narrow
layouts, saved zoom, and the docked log. Test animation behavior separately from
settled screenshots.

Target Linux x64 desktop while retaining existing browser support. Preserve
existing data locations and settings compatibility. Normal desktop launch stays
live; automated tests use isolated mock profiles.

Retain first-launch Docker builds from bundled locked source and subsequent
image reuse. Concurrent-use features, data migration, automatic updates, other
desktop platforms, and publishing remain outside this series.
