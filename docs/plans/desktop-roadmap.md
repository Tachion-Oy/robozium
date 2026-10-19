# Desktop application roadmap

## Goal

A native desktop application for Linux and macOS that looks and behaves
exactly like the accepted Electron experiment
(`/home/tommi/Projects/robozium-electron`, branch `experiment/electron`,
commit `076b2c9`). It is built on production-grade code: Electron main +
preload, a React/Vite renderer talking directly to the Python API, explicit
state owners, and native regression tests. The browser application under `web/`
stays as it is.

## Starting point

Steps 1–8 are merged in `main`: the Electron scaffold, the Vite renderer,
desktop Docker configuration, backend lifecycle from main, the direct API
client, project/model selection, and run creation with live output. Their
engine is kept. Their presentation layer (`desktop/renderer/src/ui/**`) was
re-authored by eye instead of reusing the reference CSS, and is replaced
below. Earlier plans for steps 3a–3d are superseded.

The experiment is `web/` copied into `desktop/web` plus a ~1.2k-line desktop
delta, running the Next.js server in Docker. Its look comes from the web
application's CSS, which was tuned by hand over weeks.

| Layer | Source | Status |
| --- | --- | --- |
| Electron main, preload, backend controller, Docker lifecycle | `main` (`desktop/src/`) | Keep |
| API transport, run/session/project/model owners | `main` (`desktop/renderer/src/{api,run,session,projects,models,hud,app}`) | Keep; extend through owners |
| Presentation: markup, class names, CSS, layout hooks | Experiment (`desktop/web/app/{components,styles}`, `desktop/web/hooks/*`) | Import as the starting point, replacing `renderer/src/ui/**`; iterate from there |

## Presentation rules

- **Start from the reference CSS, unchanged.** Copy its files, selectors
  (`agent-hud__*`, `term-*`, …), tokens and values. Do not rename classes,
  re-derive values by eye, or write a parallel stylesheet. Read the reference
  source; the running reference app is for verification.
- **Reuse the reference markup.** Leaf components that take only props are
  copied as-is. Containers (`AgentHUD`, `RunHud`, `HudScreenContent`,
  `ProjectOverview`, `ModelSelector`) keep their JSX; only their hook/store
  reads are swapped for props from the desktop owners.
- **Desktop mode is on.** `<html data-desktop>` is set in
  `renderer/index.html`, so the reference's `desktop.css` applies: the 75% UI
  scale, the opaque full-window HUD, and the in-window project badge.
- **Prefer copies from `web/`.** When an experiment file is identical to its
  `web/` counterpart, copy it from `web/` (note the source path and commit).
  Otherwise copy the experiment's version. Copies only: no imports from
  `web/`, no shared packages or dependencies until Phase 2, and `web/` itself
  is never modified.
- **Strip only framework glue.** That means `"use client"`, Next imports and
  `useSearchParams`. Configure the `@/` alias in Vite/tsconfig rather than
  rewriting imports.
- **The reference is the starting point, not a frozen spec.** A component's
  CSS arrives unchanged, so the first result matches the reference. After that
  the desktop CSS is ours and keeps evolving through normal design iteration.
  Edit it in place, in focused visual PRs, rather than reinventing it or
  layering overrides on top.
  - First known improvement: the current desktop button octagon (a single
    `.hud-button` clip-path) has more uniform corners and no gaps at the
    intersections. Carry it over onto the reference selectors.
- **Fix known reference hacks while porting** (behavior must stay the same):
  - A body-wide MutationObserver infers readiness → replace with an explicit
    `ready()` call.
  - `window.robozium!` → a typed bridge.
  - `window.confirm` → the HUD's in-place confirmation.
  - Layout and theme constants duplicated between main and CSS → one shared
    module.
  - `useDesktopActionLayout` must re-place action buttons that mount later.
    The current desktop copy lost this, which is why button stacking breaks.
- **No mock branches in production components.** Previews run against the mock
  backend.

## Visual check

A capture harness (step 9) runs the experiment and the desktop app against the
same mock backend data. It captures matching states:

- **Windows:** client widths 1260, 900, 760 and 640, plus the wrap transitions.
- **Zoom:** 100% and 125%.
- **Themes:** dark and light.
- **Layouts:** each divider layout.

It then pixel-diffs each pair.

- **While a screen is being transplanted,** the experiment is the baseline. A
  PR claims a match only for states whose diff passes. Remaining differences
  are listed in the PR as intended changes (such as the octagon) or open work.
  Screenshots of the desktop app alone are never evidence of a match.
- **Once a screen is transplanted,** its captures become the desktop app's own
  regression baseline. A deliberate design change updates that baseline in the
  same PR, with before/after captures.
- Animations are checked separately from settled captures.

## Milestone A — The look (steps 9–13)

Each step is one PR and is runnable: launch the app to see its result.

| Step | Result | Check |
| --- | --- | --- |
| **9. Parity harness** | One command launches the experiment and the desktop app on isolated mock profiles, drives the states above, and writes side-by-side captures and a diff report. A baseline report documents today's gaps. No app changes. | Two runs on the same build produce identical captures. |
| **10. Stylesheet foundation, frame and header** | Copy the reference global, theme, frame, selector and button CSS, the fonts, and `desktop.css`. Set `data-desktop`. Port the frame, project badge, header, model/view selectors and theme toggle with reference markup. Delete the replaced `ui/` CSS and components. The octagon follows as its own visual PR. | Header and frame match in both themes at all widths and zooms, including label truncation. |
| **11. Running HUD** | Port the message panel, Markdown, composer, message navigation and footer actions. Copy `hud-panels.css` (`hud-controls.css` arrived with the corner controls in step 10). Port `useDesktopActionLayout` with mount handling. Actions not yet wired (send, interrupt, cancel, record) render disabled. Links render but stay inert (see follow-ups). | Running, script and Markdown states match. Button stacking and wrapping match at every width, at both zooms. |
| **12. Projects overview** | Port `ProjectOverviewPanel` and its CSS: status, start/open/return, empty state, New Project entry. Cancel/delete render as in the reference and are wired in steps 15–16. The capability selector slot waits for step 20. | Empty and populated overview match. |
| **13. Docked message log and theme persistence** | Port `MessageLog`, the toggle, `TerminalStream`/`renderContent` and the terminal CSS. Add a `useMessageLog` owner and native window grow/shrink in main, with shared size constants. Persist theme and log state through named preload methods; set the native background per theme. | Log open/closed matches side-by-side (≥1120px) and stacked (<1120px). Theme survives a restart. |

**Order from here** (chosen after step 11): a working Runs overview first, with
the capability selector from step 20 pulled in, then a working HUD.

1. **Projects and launch owners:** full project summaries, capability requests,
   and the launch command (create project, resolve and save capabilities, create
   run). No visible change; the interim **Start run** uses it.
2. **Step 12 with the step 20 selector:** the reference overview and capability
   selector UI, replacing the interim overview, with the reference's cancel and
   delete. `UnlockApiKeys` stays in step 20.
3. **Overview cancel and delete hardening** (steps 15 and 16, overview side):
   #101's uncertain-outcome reconciliation, on one keyed request registry
   shared by both, distinguishing outstanding, acknowledged and reconciling
   writes. The launch marking and refresh sequence moves from the overview
   component into its owner, so every launch entry point gets the same
   guarantees.
4. **Step 14:** replies (done: `session/useRunMutations`, bound to the session scope).
5. **Step 15, HUD side:** interrupt, HUD cancel, and returning to the overview
   when a run ends or goes missing.
6. **Step 17:** reconnection and recovery.
7. **Step 13:** the message log, as a selector over the run's retained events
   (see `desktop/renderer/src/ARCHITECTURE.md`), plus theme persistence.

**Follow-ups found in step 11** (each its own small PR):

- **CSP-compatible toaster.** The reference uses `react-hot-toast`, whose
  injected inline styles the renderer's CSP blocks. Until then,
  `ui/feedback/ErrorToast.tsx` keeps the reference's `showErrorToast` call shape
  and shows failures as alerts in the notices row.
- **Preview against the mock backend.** Standalone preview duplicates the
  overview with local rows and inert controls; running it against the mock
  backend removes that separate path.
- **Opening links.** Markdown file and external links render but do nothing:
  `main.ts` denies new windows and navigation. Opening a hub file or an
  external page needs a named preload operation with validated targets.

## Milestone B — Running work (steps 14–17)

These steps add behavior through owners, under the already-ported UI.

**Source: PR #101.** Branch `feat/desktop-run-interactions` (head `4a759b5`)
already implements this behavior, plus the startup splash, and has been
polished at length. It was closed unmerged only because it was too large to
review in one go (84 files, +5.3k lines) and was written against the old
`ui/`. Each step below brings its slice across instead of re-implementing it:

- Review the slice and take its owners, API changes and native specs.
- Discard its `ui/` edits (`HudPanels`, `HudFooter`, `Projects` markup) and
  connect the owners to the reference markup instead.
- Keep the PR within the review size rules.

| Step | Slice of #101 |
| --- | --- |
| 14 | `session/useRunInteractions`, `app/useReplyDraft`, `tests/interactions.spec.ts`; `ARCHITECTURE.md` and its diagrams, updated as each later owner lands |
| 15 | `projects/useProjectCancellation`, `app/useRunNavigation`, `app/run-availability`, `tests/cancel-navigation.spec.ts`, `tests/open-run.spec.ts` |
| 16 | `projects/useProjectDeletion`, `projects/useProjectManagement`, `projects/projects-api` changes, `tests/deletion.spec.ts` |
| 17 | `api/retry`, `run/run-updates` and `run-reducer` changes, `backend/useBackendReadiness`, `recovery/*`, `session/useRunLifecycle`, `app/useProjectWorkspace`, `tests/reconnection.spec.ts`, `tests/recovery.spec.ts` |
| 21 (startup) | `splash/*`, `src/bootstrap.cjs`, `src/prepare-desktop.cjs`, `src/preload.cjs`, `scripts/build-desktop.mjs`, `tests/startup.spec.ts` |

| Step | Result | Check |
| --- | --- | --- |
| **14. Replies** | Typed reply submission with a request deadline. The draft clears only after an acknowledged, unchanged submission. Keyboard/IME send. | Native tests: acknowledgement, edits during submission, rejection, deadline. |
| **15. Interrupt and cancel** | Interruption owned by the run session. Project cancellation shared between the HUD and overview rows, with status polling while pending. | Cancel from either place, interrupt during a reply, return to the overview on completion. |
| **16. Project deletion** | Confirmed deletion of dormant projects with the in-HUD confirmation. Pending deletion survives listings; focus moves to the next row. | Uncertain responses, 409 active-work gate, removal of the displayed run. |
| **17. Reconnection** | One stream and one serialized snapshot reader per run, with backoff and deadlines. Missing runs return to the overview. No write is retried automatically. | Backend restart mid-run without duplicates; missing-run and terminal-run cases. |

## Milestone C — Remaining features (steps 18–21)

| Step | Result | Check |
| --- | --- | --- |
| **18. Environment** | Environment panel (display, edit, import, reset) with its own API module and owner. Restart app with in-HUD unsaved-edit confirmation. | Edits, imports, validation failures, persistence and restart against isolated mock data; captures match. |
| **19. Dependencies** | Dependency panel and diagnostics. Restart/recreate backend through `backend-controller.ts`, limited to owned services. | Available/missing/error states and restart/recreate; captures match. |
| **20. Credentials and capabilities** | `UnlockApiKeys` and the overview capability selector, through owners. | Lock/unlock, failures and capability persistence; captures match. |
| **21. Dictation and startup** | Dictation (`useDictation`, audio meter, transcription endpoint) with microphone permission. Bring over #101's startup splash (see Milestone B) and its handoff to the painted HUD. | Recording lifecycle and permission denial. Startup animation and handoff compared with the reference. |

## Milestone D — Ship (steps 22–24)

| Step | Result |
| --- | --- |
| **22. Instance handling** | Duplicate-launch focus, settings validation, window size and zoom preferences, independent test profiles. |
| **23. Portable backend runtime** | Remove the Linux-only assumptions so the same code runs on macOS (details below). |
| **24. Packaging for both platforms** | One `electron-builder` configuration with two targets, built with `npm run package:linux` and `npm run package:mac`, from shared allowlisted resources and locked backend inputs. Linux produces a `.deb`. macOS produces a `.dmg` for arm64 and x64; it is unsigned at first, and signing/notarization is an opt-in follow-up driven by environment variables. |

Step 23 covers:

- **Networking:** replace `network_mode: host` in `desktop/compose.yaml` with
  ports published on loopback (`127.0.0.1:<port>:<port>`). Uvicorn binds
  `0.0.0.0` inside the container.
- **Docker discovery:** also check `/opt/homebrew/bin` and
  `/Applications/Docker.app/Contents/Resources/bin`. Mac GUI apps do not
  inherit the shell `PATH`.
- **Process cleanup:** platform-neutral process-tree cleanup.
- **Mac app conventions:** the app menu, and the app staying open with no
  windows.

It is verified on Linux CI and with a manual run on a Mac with Docker Desktop.

Step 24 is verified in CI on both platforms:

- **Linux:** install the `.deb` and exercise it in disposable CI without host
  Node or Python.
- **macOS:** the runner builds the `.dmg` and launches the packaged app. Hosted
  macOS runners have no Docker, so the CI check covers the missing-Docker state
  and the renderer. The full backend flow is a documented manual check on a Mac.

Large steps may be split into smaller runnable PRs. Do not merge steps together.

## Phase 2 — Consolidation

Start only after both applications pass their own checks. Extract genuinely
shared code one family at a time, in this order: pure helpers and tokens, then
CSS and presentation components, then state with matching semantics. Each
extraction switches both consumers and deletes the copies in the same PR. Entry
points, the Next.js BFF, Electron main/preload and Docker lifecycle stay with
their own application.

## Folder boundaries

- `web/` owns the browser application.
- `desktop/` owns Electron, the renderer and its copies of reference code.
- The Python backend serves both.

Desktop must build without importing from `web/`, without installing `web/`
dependencies, and without starting Next.js. Copies live inside `desktop/` until
Phase 2.

## Review rules

- **Size:** target 200–400 changed lines of hand-written production code per
  PR.
- **Copies:** a PR that copies reference files does so in one commit that
  contains only verbatim copies, each byte-identical to its source in the
  experiment (at `076b2c9`) or `web/`. The PR description lists each file's
  source path and gives a command that diffs them. All adaptations,
  including import paths and comments, go in the following commit, so its
  diff is exactly what changed. Copy only what the step uses; later steps
  bring their own files.
- **Contents:** each PR includes tests, a runnable demonstration, the capture
  report for the states it touches, and an explanation of any new owner or
  responsibility.
- **Architecture:** state stays in owners; components render props and invoke
  callbacks. Keep feature modules independent of `ui/` and shared `api/`
  independent of features. Use named preload operations for desktop privileges
  and HTTP/SSE for application traffic.
- **CI:** existing native specs and the browser Full E2E jobs stay green on
  every PR.
- **Never modify:** the experiment, `web/`, or user data.

## Runtime scope

- **Platforms:** Linux x64 and macOS (arm64 and x64). Docker (Docker Desktop
  on macOS) is required for the Python backend and CLI tools.
- **Portability rule for every PR:** new code must not add platform
  assumptions. Use `path`/`os` APIs, never hard-coded Linux paths, host
  networking or Linux-only signals. Window chrome and shortcuts use
  Electron's cross-platform APIs.
- **Launch modes:** normal launch is live; tests use isolated mock profiles.
- **Out of scope:** automatic updates, Windows and store publishing.
