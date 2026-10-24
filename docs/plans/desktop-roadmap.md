# Desktop application roadmap

## Goal

A native desktop application for Linux and macOS that looks and behaves
exactly like the accepted Electron experiment
(`/home/tommi/Projects/robozium-electron`, branch `experiment/electron`,
commit `076b2c9`). It is built on production-grade code: Electron main +
preload, a React/Vite renderer talking directly to the Python API, explicit
state owners, and native regression tests. The browser application under `web/`
stays as it is.

Parity also covers features added to `web/` after the experiment was cut
(2026-10-13): image attachments and, once merged, API-key onboarding. For
those, `web/` is the reference, since the experiment predates them.

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

## Status

Reviewed against `origin/main` at `e1ba35b` (after #145).

| Step | State | PRs |
| --- | --- | --- |
| 1–8 Scaffold, renderer, backend lifecycle, API client | Done | — |
| 9 Visual regression | Replaced by desktop screenshot tests; the cross-app harness was never committed | — |
| 10 Frame and header | Done (octagon follow-up open) | #102 |
| 11 Running HUD | Done; Record disabled, links inert | #104 |
| 12 Projects overview with capability selector | Done | #105, #106 |
| 13 Message log and theme persistence | Done | #123, #124, #127 |
| 14 Replies | Done | #108 |
| 15 Interrupt and cancel | Done, including Interrupt on Send | #110 |
| 16 Project deletion | Done (with the overview) | #106 |
| 17 Reconnection | Done; recovery dropped | #112, #113 |
| 18 Environment | Done | #116, #117 |
| 19 Dependencies | Done | #126 |
| 20 Credentials and capabilities | Done | #106, #115 |
| 21 Dictation and startup | Dictation done; startup not started | #131 |
| 22 Instance handling | Window size, zoom and second-instance focus done | #127 |
| 23–24 Ship | Linux packaging done; macOS deferred | #129 |
| Toasts (step 11 follow-up) | Done | #120 |
| 25 Image attachments | Done | #128 |
| 26 Onboarding | Done, with key-file adoption | #136, #137 |
| 27 UI tweaks | Not started | — |
| 28 Opening links | Done | #131 |
| 29 Inline agent images | Done | #151 |

**Order from here.** Related small steps share a PR so each CI run covers
more ground; 200–400 hand-written lines is the ceiling, not the target.

| # | PR | Contents |
| --- | --- | --- |
| 1 | Startup splash | 21b, keeping the current splash artwork |
| 2 | UI tweaks | Step 27: light theme, stable selectors, no project title in Runs view, footer layout, octagon |
| 3 | App logo | Step 27's app identity: the logo goes on the splash, the window icon and the `.deb` icon |
| 4 | Preview mode | Remove `--preview` or run it against the mock backend (see the step 11 follow-ups) |
| 5 | Instance handling leftovers | Step 22: settings validation and independent test profiles |
| 6 | macOS | Step 23 and the macOS half of 24; deferred |

## Parity checklist

Gaps against the experiment (E) and current `web/` (W). Tick an item off in
the PR that closes it.

| Gap | Ref | Desktop today | Step |
| --- | --- | --- | --- |
| Theme persistence; native background `#07080a` dark, `#f3f0e7` light | E | Done (#123) | 13a |
| Message log pane, toggle, `TerminalStream`/`renderContent`, `DemoLog` | E | Done (#124) | 13b |
| Window grow/shrink for the log (side-by-side ≥1120px, stacked below; restore unless user-resized) | E (`message-log-window.cjs`) | Done (#127) | 13c |
| Image attachments: paste, drop, picker, thumbnails, remove, retry, image-only replies | W | Done (#128) | 25 |
| Agent images inline: compact previews, larger viewer, original-image link | W (#125) | Done (#151): hub images load from the backend; originals open outside the window | 29 |
| Markdown and `<file src>` hub-file links, including sent images | W (new design for desktop) | Done (#131): web links open in the browser, hub files with their default application | 28 |
| Dictation: Record, audio meter, `/transcribe`, microphone permission | E, W | Done (#131) | 21a |
| Dependencies panel: sort, Check now, copy diagnostic | E, W | Done (#126) | 19 |
| Backend restart/recreate (`BackendControls`) | E | Done (#126) | 19 |
| Startup splash, handoff to the painted HUD, splash during restart | E | Plain `ui/backend/BackendStartup.tsx` | 21b |
| Window 1260×780 default, 640×420 minimum, 90% of work area maximum, size saved | E | Done; the 90% cap applies to sizes the app picks, not to manual resizing | 22 |
| Zoom ±0.1 within 0.5–3, saved | E | Done | 22 |
| Second-instance focus | E | Done | 22 |
| API-key onboarding and setup gate | W (#121) | Done; Environment also adopts an existing `.env.encrypt` | 26 |
| Switch the open run's model mid-run (`run_id` on `/models`) | W | Done: Current Run reads and switches its run's model | Fix |

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

A capture harness (step 9, now superseded by desktop snapshot tests) runs the experiment and the desktop app against the
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
| **9. Visual regression** | The cross-app parity harness was used locally for #102 and never committed. Now that most screens are ported and step 27 changes the look deliberately, the desktop app's own screenshot tests (`toMatchSnapshot` in the native specs, as in `scaffold.spec.ts` and `footer.spec.ts`) are the baseline. Remaining ports (message log, dependencies, splash) are compared with the experiment by eye. | Snapshot specs cover each ported screen in both themes; deliberate changes update the baselines with before/after captures. |
| **10. Stylesheet foundation, frame and header** | Copy the reference global, theme, frame, selector and button CSS, the fonts, and `desktop.css`. Set `data-desktop`. Port the frame, project badge, header, model/view selectors and theme toggle with reference markup. Delete the replaced `ui/` CSS and components. The octagon follows as its own visual PR. | Header and frame match in both themes at all widths and zooms, including label truncation. |
| **11. Running HUD** | Port the message panel, Markdown, composer, message navigation and footer actions. Copy `hud-panels.css` (`hud-controls.css` arrived with the corner controls in step 10). Port `useDesktopActionLayout` with mount handling. Actions not yet wired (send, interrupt, cancel, record) render disabled. Links render but stay inert (see follow-ups). | Running, script and Markdown states match. Button stacking and wrapping match at every width, at both zooms. |
| **12. Projects overview** | Port `ProjectOverviewPanel` and its CSS: status, start/open/return, empty state, New Project entry. Cancel/delete render as in the reference and are wired in steps 15–16. The capability selector slot waits for step 20. | Empty and populated overview match. |
| **13a. Theme persistence** | Named preload `getTheme`/`setTheme` backed by a settings store in main. Apply the stored theme before first paint; set `nativeTheme.themeSource` and the window background per theme. | Theme survives a restart with no dark flash in light mode. |
| **13b. Message log** | Port `MessageLog`, the toggle, `TerminalStream`/`renderContent`, `DemoLog` and the terminal CSS. A `useMessageLog` owner selects from the run's retained events (see `desktop/renderer/src/ARCHITECTURE.md`). The toggle sits in the footer slot from step 27. | Log open/closed matches the reference in both themes. |
| **13c. Native log window sizing** | Port `message-log-window.cjs` into main with size constants shared with CSS. Grow side-by-side at ≥1120px, stacked below; restore the original size unless the user resized; re-expand on zoom. Persist log state through a named preload method. | Open/closed matches side-by-side and stacked, at both zooms. |

**Follow-ups found in step 11** (each its own small PR):

- **CSP-compatible toaster — done.** `feedback/notices` owns error, warning and
  success notifications; `ui/feedback/ToastViewport` renders the reference content
  and stylesheet in a top-centre stack without inline styles. Dismissal keeps the
  exit animation, and hovering pauses the five-second lifetime. Persistent errors
  and Retry controls remain in the notices row.
- **Preview mode.** `npm run start:preview` opens the app without a backend:
  `ui/app/App.tsx` and `app/preview.ts` substitute a local project, messages
  and models, and Record is unavailable. Every connected feature carries a
  "no client" branch for it. Remove the mode, or run it against the mock
  backend, and delete those branches.
- **Opening links.** Promoted to step 28.

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

**Dropped from step 17:** #101's `recovery/*`, which reopened the shown run and
kept the draft across restarts. Closing or restarting the app stops the backend
and its runs, so there is no live run to reopen and only the draft would
survive. It returns in one piece if runs ever survive a backend restart.

**Interrupt on Send** shipped with step 15 (#110): an acknowledged reply
enables Interrupt at once, without waiting for a poll. Streaming prompt events
to remove the remaining Send delay (#130) was tried and dropped as far too large
for the gain.

## Milestone C — Remaining features (steps 18–21, 25–28)

| Step | Result | Check |
| --- | --- | --- |
| **18. Environment** | Environment panel (display, edit, import, reset) with its own API module and owner. Restart app with in-HUD unsaved-edit confirmation. Done: `environment/useEnvironmentDraft` and `useEnvironmentMutations`, folder import and Restart app (`desktop:relaunch`). | Edits, imports, validation failures, persistence and restart against isolated mock data; captures match. |
| **19. Dependencies** | Dependency panel and diagnostics. Restart/recreate backend through `backend-controller.ts`, limited to owned services. | Available/missing/error states and restart/recreate; captures match. |
| **20. Credentials and capabilities** | `UnlockApiKeys` and the overview capability selector, through owners. Done: the selector in step 12, `UnlockApiKeys` through `credentials/useCredentials`. | Lock/unlock, failures and capability persistence; captures match. |
| **21a. Dictation** | `useDictation` owner, audio meter and a transcription API module. Allow only `media` (audio) for the trusted main frame; every other permission stays refused. Enable Record. | Recording lifecycle and permission denial. |
| **21b. Startup** | Bring over #101's startup splash (see Milestone B) and its handoff to the painted HUD, including the splash during restart. | Startup animation and handoff compared with the reference. |
| **25. Image attachments** | From `web/`, not the experiment. **25a:** copy the newer `ReplyForm`, `ReplyEditor`, `useReplyImages` and `reply-images`; add an `api/attachments` module (`POST/GET/DELETE /run/{id}/files[/{attachmentId}]`, client `upload_id` for retries) and a per-run image queue owner. **25b:** paste, drop and picker via react-dropzone, previews (CSP `img-src` for `blob:` and the backend origin; check the `desktop_access` Host/Origin rules), remove, retry, image-only Send. The backend and RoboZ `read_images` need no change. | Native spec: paste an image, upload, send; the agent turn receives the file. Limits and rejections match `web/`. |
| **26. Onboarding** | Blocked on #121. Port the `setup_required` gate (423 for provider actions), the locked HUD with START HERE, `OnboardingHud` and its pages. | Fresh live profile shows onboarding; the first Environment save unlocks without a restart. |
| **27. UI tweaks** | Several small visual PRs, each editing the desktop CSS and markup in place with before/after captures in both themes. Checklist below. | Captures per item. |
| **28. Opening links** | Two validated preload operations. `openExternal(url)` accepts http(s) only and calls `shell.openExternal`. `openHubFile(path)` resolves inside the hub directory with a realpath containment check and calls `shell.openPath`. Sent images open the same way. | Native specs: allowed and rejected targets, including traversal and symlink escapes. |

Step 27 checklist (append further small findings here):

- [ ] **Light theme:** tune the colours and make them more pronounced.
- [ ] **Project title in Runs view:** the label is misplaced there; the Runs
  overview should not show a run's project title at all.
- [ ] **Stable selectors:** options in every selector (view, model) never
  disappear. Unavailable options stay listed with a dimmed, disabled style,
  so an open dropdown keeps its size when the backend changes, for example
  when a run ends and Current Run can no longer be reopened.
- [ ] **Footer layout:** move the three small buttons to the right-hand side
  and add the message-log button slot (before 13b).
- [ ] **App identity:** a favicon and app logo/icon distinct from the company
  logo, used for the window icon and step 24's packaging icons. Ships with
  the splash (21b), which shows it.
- [ ] **Octagon:** the button shape improvement on the reference selectors
  (see Presentation rules).

## Milestone D — Ship (steps 22–24)

| Step | Result |
| --- | --- |
| **22. Instance handling** | Duplicate-launch focus (`second-instance` handler), settings validation, independent test profiles. Window as in the experiment: 1260×780 default, 640×420 minimum, at most 90% of the screen work area, size saved. Zoom in steps of 0.1 between 0.5 and 3, saved, and applied to the splash too. |
| **23. Portable backend runtime** | Remove the Linux-only assumptions so the same code runs on macOS (details below). |
| **24. Packaging** | **Linux now:** one `electron-builder` configuration, built with `npm run package:linux`, producing a `.deb`. The installed app keeps its profile in Electron's `userData` (`~/.config/Robozium`), not next to a checkout, and ships the staged backend and Compose files as plain resources for Docker. A `v<version>` tag publishes it as a signed apt repository on GitHub Releases, so users install with `apt install` and upgrade with `apt upgrade` without losing their profile or hub. **macOS later:** a `.dmg` for arm64 and x64 from the same configuration (`npm run package:mac`), unsigned at first, with signing/notarization as an opt-in follow-up driven by environment variables. |

Step 23 (macOS, deferred) covers:

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

Step 24 is verified in CI:

- **Linux:** install the `.deb` and exercise it in disposable CI without host
  Node or Python.
- **macOS (later):** the runner builds the `.dmg` and launches the packaged app. Hosted
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
- **Out of scope:** in-app automatic updates (Linux upgrades come through apt), Windows and store publishing.
