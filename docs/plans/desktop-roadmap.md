# Desktop first migration and final consolidation

## Approach

Build the Electron application independently, preserving the experiment's
appearance and the existing browser experience. Keep each application runnable
and testable from its own folder. Complete and validate the Linux desktop
application before extracting shared frontend code.

**Frontend decision:** the browser keeps Next.js and its BFF under `web/`.
Electron uses React with Vite under `desktop/` and must not depend on, bundle,
or start Next.js or its BFF. Vite produces the desktop application's static
assets; it is not a production server. Replacing the browser's Next.js framework
is outside this plan.

**Work sequence:** first build and package the desktop application using local
copies of the UI code it needs. Then consolidate code whose behavior has proved
to be common to both working applications. Duplication during the desktop work
is intentional; removing it is the final phase, not a prerequisite for progress.

## Folder boundaries during desktop development

| Location | Owns |
| --- | --- |
| `web/` | Existing Next.js pages, BFF, components, state, styles, assets, dependencies, configuration, and browser tests. |
| `desktop/` | Electron main and preload, React/Vite renderer, copied and adapted components, state, styles, assets, API client, dependencies, Docker configuration, and desktop tests. |
| Existing Python backend | The API and application services used by both clients. Desktop consumes this existing service; it does not introduce a second Python implementation. |

Desktop must build and run without importing files from `web/`, installing its
npm dependencies, or starting its server. Browser commands must work without
installing or building `desktop/`. Keep UI tests and fixtures with the application
they exercise. Repository CI and documentation can cover both applications.

Copy only what the current desktop feature needs. Adapt copies inside `desktop/`;
do not extract shared packages, edit browser components to accommodate desktop,
add platform flags to the browser application, or introduce cross-folder aliases
or symlinks. Record the source file and commit in each porting PR description so
the copied code and its adaptations are reviewable. Copying does not exempt code
from the PR size limits.

Keep desktop Compose configuration and build inputs explicit under `desktop/`
until final consolidation. The existing Python source and lockfile remain backend
inputs; browser Compose files and its Next.js image are not desktop dependencies.
Any backend change required for safe direct API access must be a focused change
with regression coverage for both clients, not an incidental UI refactor.

## PR 1 — Introduce the Electron scaffold

**Result:** `npm --prefix desktop start` opens a native window containing a
bundled page showing “Robozium” and its application version.

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

The PR description explains this exact call:

```text
Page → preload.getVersion() → IPC → main → application version → page
```

Include a short file walkthrough in the PR description. Keep the README focused
on setup, running, and checks. The application is named Robozium; the window
contains only its title and version.

**Acceptance:** a Linux native CI test launches the window, verifies the version,
confirms the renderer cannot access Node APIs, and closes the application
successfully. Add this job to the required Full E2E gate immediately.

This PR introduces no Docker management, Next.js integration, shared-component
refactoring, or packaging. See the [detailed scaffold plan](electron-scaffold.md).

## Phase 1 — Complete the independent desktop application

PR 1 remains the small, framework-free scaffold above. The following PRs build
out `desktop/` while retaining the browser implementation and its regression
checks. Each adds a runnable result and explains one new responsibility.
PRs 1 through 7 are merged. The current increment implements the
[PR 8 run output plan](desktop-run-output.md): React starts the selected project,
streams its output, merges snapshot history, and keeps one app-level session
through view changes. Explicit output retry reconnects the known ID; terminal
runs remain readable. Run reconciliation and desktop HUD presentation have
separate reducers, composed atomically by the session. Run state owns status,
prompts and backend events; the HUD owns display boundaries and selection.
HUD helpers separate typed message extraction, history grouping and display
selection. Typed run operations share payload validation for snapshots and SSE.
The renderer keeps all TSX components and CSS in `ui/`, grouped by feature, with
TypeScript hooks/APIs/state in sibling feature folders. Session ownership
coordinates run and HUD state; shared `api/` code supplies request infrastructure.
`watchRun()` coordinates SSE and polling in `run/run-updates.ts`.
Provider retry resets transient output; active prompts and
settling text retain their place in the single-message panel, with explicit
history pinning. Script identities and prompt boundaries survive history
recovery. Token updates do not rebuild completed history. Standalone preview
retains its local history. Replies,
cancellation controls, automatic reconnection, and reopen recovery follow in PR 9.
Rich Markdown and artifact-link rendering remain tracked presentation parity work.

| PR | Change | Acceptance |
| --- | --- | --- |
| **2. Add the React and Vite renderer** | Render the existing name/version example with React. Build with Vite and load bundled assets through a restricted custom protocol. Keep main/preload explicit and preserve their security settings. | The native example and error state work in development and from built assets, without Next.js or anything installed under `web/`. Existing IPC, navigation, and close/reopen checks pass. |
| **3a. Port the frame and themes** | Port the experiment's full-window surface, insets, typography, and dark/light themes around the existing Robozium name/version display. | Native visual checks cover both themes, narrow windows, zoom, and keyboard focus. Assets and dependencies are local to desktop. |
| **3b.1. Add the shared button and header layout** | Add a desktop-local `HudButton` and the complete header with disabled model, secrets, and view fixtures; keep theme switching functional. | Both themes, narrow layouts, and zoom preserve the single row, full accessible names, and keyboard focus without backend requests. |
| **3b.2. Add interactive header selectors** | Add model/view selectors using local fixture state and a placeholder panel for each selected view. Keep credential operations in PR 10. | Menus support selection, keyboard navigation, dismissal, and focus retention in both themes and narrow layouts; view choices update the placeholder. |
| **3c. Port the content panels** | Start a local mock run from Runs Overview and show the message/composer layout with divider controls and a retained draft. | Opaque panels remain usable in both themes at narrow sizes and zoom. |
| **3d. Port the footer controls** | Add centered fixture-history navigation, Clear, and native clipboard writes. Keep Send/Cancel/Interrupt/Record disabled. | Local helpers preserve draft/selection, transfer focus at history boundaries, report copy success/failure, and retain DOM identity while wrapping in both themes. |
| **4. Add desktop Docker configuration** | Add a desktop-owned Compose definition and allowlisted build inputs for the existing Python backend. Document manual live/default and mock startup and shutdown; see the [PR 4 backend plan](desktop-backend-docker.md). | Build and start the backend without the Next.js service. Verify isolated data, credential exclusion/precedence, loopback-only access, health checks, one worker per hub, and restart persistence. Existing browser launchers remain unchanged. |
| **5. Manage Docker from main** | Add a focused controller for Docker discovery, image reuse/building, startup, readiness, cancellation, and owned-service shutdown. Expose only the startup status needed by the renderer. | Launch and close the native app against the real mock backend. Cover missing Docker, ownership mismatch, occupied ports, readiness failure, and cancellation without deleting user data. |
| **6. Connect the desktop API client** | Add direct HTTP/SSE transport, the selected-address bridge/CSP, backend Host/Origin checks, and readiness/error/Retry presentation; see the [PR 6 plan](desktop-api-client.md). Keep application controls on fixtures. | Native tests seed and stream a real mock run, exercise initial failure/outage/recovery, and preserve HUD state. Python checks protect access policy and existing Environment/credential boundaries. |
| **7. Port project and model selection** | Adapt project listing, selection/creation, and acknowledged default model selection into desktop; see the [PR 7 plan](desktop-project-model-selection.md). Keep navigation and UI state local to desktop. | Create/select a project and choose a model using mock backend data. Preserve loading, empty, failure, keyboard, and focus behavior. |
| **8. Port run creation and live output** | Adapt run contracts, session ownership, and text presentation to start the selected project and display live updates; see the [PR 8 notes](desktop-run-output.md). Keep the desktop session within `desktop/`. | A native test starts a mock run and observes streamed output and completion. Verify cancellation of obsolete subscriptions and a single active session. |
| **9. Port replies, interruption, and recovery** | [Implementation notes](desktop-run-interactions.md). 9a: typed replies, acknowledgement guards and keyboard/IME submission complete. 9b: interruption, project cancellation and status polling complete. 9c: confirmed dormant-project deletion complete. Automatic reconnection and reopen recovery follow. | Verify draft preservation, reply submission, interruption, backend restart, and recovery without duplicate messages or subscriptions. |
| **10. Port credential unlocking** | Copy and adapt the encrypted-credential unlock state and controls. Keep keys and decryption in the backend. | Verify locked/unlocked/error states using disposable test credentials, with no secrets in frontend configuration, logs, or packaged assets. |
| **11. Port environment editing** | Copy environment display, editing, and import controls into desktop. Reuse the backend API contract rather than the Next.js routes. | Cover edits, imports, validation failures, unsaved changes, and persistence using isolated mock data. |
| **12. Port capabilities and dependency views** | Copy capability selection and dependency diagnostics into desktop. Keep native restart actions for PR 16. | Verify available/missing capabilities, selection, errors, and diagnostic rendering against the mock backend. |
| **13. Port dictation** | Copy recording controls and transcription integration. Add narrowly scoped microphone permissions for the trusted desktop renderer. | Verify permission denial, recording lifecycle, transcription failure, and cleanup on navigation or close without losing drafts. |
| **14. Restore the accepted startup sequence** | Copy the introduction and loading presentation into the existing Vite renderer. Add the offline introduction, translucent loading HUD, and painted-application handoff. | Test fast/slow startup, failure/retry, closing during startup, reduced motion, and both themes. |
| **15. Add the docked message log** | Use the desktop's copied terminal rendering and existing desktop run session. Preserve shadows, stacked layout, temporary window expansion, and restoration. | Preserve drafts, focus, and recording. Avoid duplicate session subscriptions; unmount the transcript when closed. |
| **16. Add desktop restart controls** | Connect Environment's app restart and Dependencies' restart/recreation actions through named preload methods. | Verify unsaved-edit confirmation, imported-tool activation, readiness before reveal, introduction replay, and operations restricted to owned backend services. |
| **17. Add desktop instance and preference handling** | Extend the basic backend ownership lock introduced in PR 5 with duplicate-launch focus behavior and persistence of window size, theme, and zoom. | Verify duplicate launch, invalid/stale saved settings, reliable close/reopen, and independent test profiles. |
| **18. Package and validate Linux installation** | Build a `.deb` with allowlisted resources and locked backend inputs. Document prerequisites, installation, first launch, diagnostics, and recovery. | Install and exercise the package in disposable Linux CI outside the checkout, without host Node/npm/Python or a Next.js installation. Confirm the accepted desktop workflow and appearance before consolidation. |

These are ordered review topics, not a requirement to force a large feature into
one PR. Split any topic that exceeds the review limits into smaller runnable
increments, including mechanical copies. Do not combine UI porting, runtime
integration, and shared-code extraction in one change.

## Phase 2 — Consolidate only after both versions work

Start after the desktop feature and installation checks pass and the unchanged
browser application still passes its own checks. First compare the working
implementations and list the actual common behavior; do not design a generic
platform layer in advance.

Extract one small family at a time, starting with pure helpers, types, or assets,
then presentation components, and only then state/client code whose semantics
match. Each extraction PR switches both consumers and removes the corresponding
copies in the same change. Both applications must remain independently buildable
and testable after every extraction.

Keep entry points, routing, Next.js BFF/server code, Electron main/preload,
permissions, Docker lifecycle, and platform-specific layout behavior with their
own application. Shared components receive narrow props or callbacks and import
neither Next.js nor Electron. Share Docker/build configuration only where the
working configurations demonstrably match; retain separate launch commands and
runtime ownership.

Consolidation must preserve appearance and behavior. Use existing browser and
native regression tests to prove that each extraction changes code ownership
rather than user-visible behavior. Leave a small amount of duplication where
sharing would introduce platform flags, a generic transport framework, or
coupling between the two applications.

## Review and validation rules

- Target **200–400 changed production-code lines per PR**. Split changes exceeding
  roughly 500. Identify copied code, adaptations, lockfiles, tests, and assets
  separately; do not submit a bulk frontend copy as a small implementation PR.
- Every PR includes relevant tests and documentation, a runnable demonstration,
  and an explanation of the newly introduced responsibility.
- Keep the typed preload contract specific. Use HTTP/SSE for application API
  traffic and named IPC operations for desktop privileges. Do not mirror the
  entire Python API through IPC.
- Keep `web/` and `desktop/` install/build/test commands independent. Verify
  desktop builds without web dependencies and browser builds without desktop
  dependencies. Maintain separate browser and native tests through consolidation.
- Preserve the six original Full E2E jobs and the native job introduced in PR 1.
  Every submitted PR must have green required checks on its latest commit before
  handoff; independent development does not mean dropping browser regressions.
- Test both themes, startup, idle/run HUDs, narrow layouts, zoom, and the docked
  log. Test animations separately from settled visual snapshots.
- Build onto `main` or a clearly identified prerequisite PR. Preserve the
  experiment as the visual reference, unrelated branches, and existing user edits.

## Runtime defaults and scope

Target Linux x64 desktop while retaining existing browser support. Docker remains
required for the Python backend and Linux CLI tools. Preserve existing data
locations and settings compatibility. Normal desktop launch stays live;
automated tests use isolated mock profiles and disposable data.

Retain first-launch Docker builds from bundled locked source and subsequent
image reuse. Concurrent-use features, data migration, automatic updates, other
desktop platforms, and publishing remain outside this series.
