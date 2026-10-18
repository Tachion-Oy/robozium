# PR 9 — Desktop replies, controls, deletion and recovery

Implementation base: `072341b`. Work stays desktop-local and uses existing API
endpoints. No credential, attachment, dictation or backend execution recovery work.

## 9a — Reply submission

Typed JSON replies require `{ prompt_id, content }` and `{ ok: true }`. A session
owns the request, deadline and stale-result guard. Acknowledged prompt identities
stay suppressed across delayed snapshots. Editing remains available; only an
unchanged draft is cleared after acknowledgement. Errors retain drafts and trigger
authoritative reads, with no automatic write retry.

Browser sources copied/adapted at the implementation base:
`web/lib/robozium/client.ts`, `web/lib/robozium/session/reducer.ts`, and
`web/app/components/hud/run/ReplyEditor.tsx`. Desktop owns separate contracts,
reducers and request lifetimes. Native `interactions.spec.ts` covers keyboard/IME,
duplicates, edits, obsolete acknowledgements, rejection and deadlines.

## 9b — Interrupt and Cancel

The session owns interruption; the app-owned project hook shares cancellation
between Current Run and overview rows. Status and run identity come from project
listings. Polling runs every three seconds while visible/connected, or every
250 ms with pending cancellation, including background work. HTTP acknowledgement
does not imply cancellation has finished. Cancel stays usable during interruption.
Adapted from `web/app/components/hud/projects/useProjectOverview.ts` and
`web/lib/robozium/client.ts` at the implementation base.

## 9c — Project deletion

Delete is available for confirmed dormant projects without a local conflict.
The overview arms a project-specific second activation; blur, Escape, navigation,
or changed status/run identity disarms it. Pending deletion overlays incoming
listings. Deadlines and errors trigger reads, with confirmed absence reconciling
success and no automatic DELETE retries. HTTP 409 explains the active-work gate.
Removal clears only matching selection/session references, retains the draft and
focuses the next row or project-name field. Adapted from
`web/app/components/hud/projects/ProjectOverview.tsx` and `useProjectOverview.ts`
at the implementation base. Native fixtures exercise uncertain responses and a
real mock lifecycle scenario checks cancellation before confirmed file removal.

## 9d — Automatic reconnection

Each session retains one stream and one serialized snapshot reader. Stream opens
queue a fresh snapshot after any pending read. Reads use ten-second deadlines,
two-second normal polling and cancellable exponential retries from 500 ms to a
four-second cap. A stream-open deadline does not limit a healthy long-lived SSE
response. Terminal snapshots, missing runs, malformed payloads and permanent HTTP
errors stop automatic recovery; stream HTTP 409 reconciles through a fresh read.
The generic read retry policy matches the browser's retryable HTTP statuses.
Readiness recovers through HTTP with the same backoff and retains manual Retry.
No recovery path restarts Docker or replays writes. Native tests cover retries,
missed events, deadlines, disposal and the earlier PR 8 output scenarios.

## 9e — Reopen recovery

The trusted connection bridge includes live/mock mode; preview returns null.
One versioned localStorage record per profile/mode retains the selected project,
last run/project identity and single current draft. Parsed records exclude
transcripts and prompts. Storage errors are visible without disrupting editing.
Project listings validate restored selection. A saved run is validated by a
snapshot before opening SSE; terminal history needs no subscription. Missing
runs stop reads and retain the draft in Current Run with navigation for explicit
relaunch. Successful deletion clears matching saved identities. Native tests
cover reload, mode separation, malformed/unavailable storage, deleted projects,
missing and terminal runs, and real close/reopen after backend shutdown.

## Review against PR 8 and the browser

The merged PR 8 (`072341b`, PR #98) run/HUD boundaries remain intact. Typed API
operations validate wire data; the run reducer retains authoritative prompts and
acknowledgements; HUD reducers retain presentation and history selection. The
session owns run requests, while App composes project actions and the single draft.
Browser retry statuses, cancellation reconciliation and deletion confirmation
were compared with the desktop implementation at that base.

Review tightened launch ownership: changing selection cannot transfer a pending
launch's deletion guard, and deleting an old session cannot abort an unrelated
launch. Session disposal and creation disposal have distinct lifetimes. A named
watcher interface exposes refresh/disposal, and footer actions group availability,
pending feedback and callbacks. Declined cancellations release the control for
explicit retry. Cancelling snapshots cannot reactivate an old reply prompt.
Native regressions exercise these races and pending labels in both themes at
narrow sizes and 125% zoom. Deletion moves focus once; reopening the overview
preserves navigation focus instead of replaying the previous removal.
Project creation waits for pending deletion outcomes because only the backend
knows the resulting slug; this prevents recreation from racing a delayed DELETE
acknowledgement while preserving the typed project name.

## Verification

Local validation passed:

- Desktop lint, all TypeScript projects, production build and `git diff --check`.
- All 210 desktop tests, including unchanged preview screenshot baselines, both
  themes, narrow layouts, 125% zoom, keyboard focus, subscription cleanup,
  visually steady project polling and immediate native splash startup.
- All 13 native backend lifecycle scenarios on the final assets, including real
  Enter/Send replies, automatic overview return, existing-run opening and
  cancellation/deletion. Captured overview screens were inspected in both themes
  at 640×420 with 125% zoom. Native suites ran sequentially on fixed build assets.
- All 34 controller lifecycle tests, 13 staging/Compose checks and the isolated
  Docker startup/restart/persistence smoke test.
- All 149 applicable Python desktop-access, API, project and run-manager tests.
- Local documentation links resolve; no dependency lockfiles or preview baselines
  changed. The original checkout and other worktrees remain intact.

No PR was opened or pushed. CI and Full E2E remain required before any later PR
handoff or merge; these local results do not replace them.

## Behavioral comparison at 072341b

Source comparison covers `AppView.tsx`, `hud/run/{RunHud,ReplyForm,ReplyEditor,
AgentMessagePanel,HudMessageNavigation}.tsx`, `hud/projects/ProjectOverview.tsx`,
`useProjectOverview.ts` and `lib/robozium/session/{index,connection}.ts` under
`web/app/components` and `web/lib`, respectively. Matching endpoints alone does
not establish presentation or navigation parity.

| Flow | Browser behavior | Desktop outcome |
| --- | --- | --- |
| Start/open | Launch only dormant projects; open known active runs. | Corrected: syncing/cancelling rows cannot launch; Open run validates the existing ID and reuses the current session when possible. |
| Reply | Trim content, Enter submits, Shift+Enter edits, IME does not submit; keep edits during requests. | Matched; desktop additionally guards draft revisions and obsolete prompt/session acknowledgements. |
| Interrupt/cancel | Run interruption, project-wide cancellation, pending controls and authoritative reconciliation. | Matched for supported text flows; cancellation remains available during interruption. |
| Run stops | Return to overview on completed/failed/cancelled; background project status can still be syncing. | Corrected: terminal snapshots return once, preserving draft/history. Explicit navigation and newer launches win. |
| Background cancellation | Overview polls until dormant/absent. | Same reconciliation; cancelling background work from reopened history also returns after confirmation. |
| Deletion | Dormant-only, two-step confirmation with dismissal. | Matched; desktop also reconciles uncertain deletion by fresh listings without repeating DELETE. |
| Reconnection | One session, serialized snapshots, capped retry delays and terminal stop. | Same ownership and backoff; desktop adds request deadlines and readiness recovery. |
| Reopen/missing run | Browser routing controls entry and exits permanent failures. | Deliberate desktop recovery: saved terminal runs reopen as history; missing runs retain the draft and require explicit relaunch. |
| Models | `ModelSelector.tsx` reads and changes the active run's model when a run ID is present. | The PR 7 desktop selector still changes the backend default for future runs. Per-run model switching remains unported. |
| Presentation | Rich Markdown/links, activity animation, dictation, credential controls. | Partial port: literal text, a status glyph, disabled recording/unlocking, and placeholder environment/dependency views. These are not full visual or feature parity. |

The navigation follow-up adds App-owned run identity guards. Project cancellation
reports confirmed completion once; it cannot redirect a different session.
History remains explicitly accessible and a restored terminal run never starts
polling again. Native tests cover all terminal statuses, active/background
cancellation, recovery, pending writes, newer navigation and existing-run opens.
Real mock lifecycle checks require automatic overview return before deletion and
after the final reply. The prior PR 8 decision to omit browser route exit is
superseded by this follow-up; its run/HUD reducer separation remains unchanged.

## Startup measurement and correction

A local sequential measurement before the change took approximately 21 seconds:
backend staging 0.08 s; main, renderer, test and tooling checks 3.33, 3.34, 5.57 and
3.54 s; repeated main compilation 3.45 s; renderer bundling 1.70 s. These are
development preparation timings, not Docker build/readiness timings.

`build` now compiles/checks the main application, checks the renderer and bundles
it, taking 8.69 s in the follow-up measurement. `typecheck` retains all four
projects; CI already runs it explicitly before building and remains unchanged.
`start:built` opens unchanged staged/compiled inputs without this preparation;
regular `start` remains the command after source changes. No automatic cache or
mtime shortcut can silently hide changed source.

## Immediate startup and steady polling follow-up

Runs Overview now shows its loading message only before the first successful
listing. Normal three-second reads and 250 ms cancellation reads retain the
existing layout, empty-state message and keyboard focus. Status changes and
errors still reconcile normally. The run status mark always uses the Anurati A;
using the first letter of a status incorrectly changed it to C on cancellation.

The maintainer requested the experiment's immediate animated startup and
authorized copying its splash presentation. An uncompiled, type-checked Electron
entry opens the window before staging or compilation. One sandboxed splash view
covers the same window while the application builds and starts underneath it.
The reference introduction's cascade, lettering, octagon and pulsing A are adapted
to offline HTML/CSS/JavaScript; [attribution](../../desktop/splash/SOURCES.md)
records the presentation-only copy. No reference backend or run logic is imported.

The application reports initial readiness and waits for fonts and two paint
frames. The splash completes its introduction, fades to that painted application,
then disposes its view. Reduced motion skips reveals/fades. Compiler failures
offer explicit Retry; backend failures reuse prepared assets. A renderer readiness
retry checks HTTP without restarting a ready backend. Closing cancels compilation
and retains the existing owned-container shutdown. The profile lock is acquired
before preparation, preventing duplicate managed launches from rebuilding files.

The shared preparation runner is also the CLI build implementation, preserving
the same checks without duplicating shell command sequences. Native tests use
isolated compiler outputs to hold preparation pending, reject a build, retry,
verify duplicate-launch exclusion and close a stubborn compiler. Normal HUD tests
reduce motion only in the splash document and wait for its disposal before input.

An isolated native `--prepare --preview` launch showed the window after 775 ms
and the painted HUD after 10.263 s, including the real TypeScript/Vite build.
These are local measurements, not a startup guarantee or Docker readiness timing.
Compilation remains visible behind the animation. Review also covered native zoom
after splash disposal and readable startup errors at 640×420 with 125% zoom.

## Readability and ownership follow-up

The project hook and App had accumulated unrelated state, effects and dense
conditional expressions. The refactor accepts more source lines to expose the
actual lifecycle and make each owner readable independently:

| Owner | Responsibility |
| --- | --- |
| `projects/useProjects.ts` | Listing/polling, selected project, creation draft and removal focus. |
| `projects/useProjectMutations.ts` | Cancellation/DELETE requests, duplicate exclusion, settlement from listings and suppression of stale deleted rows. |
| `app/useRunWorkspace.ts` | Connect feature owners; launch/open runs and restore/save recovery intent. |
| `app/useRunNavigation.ts` | Explicit navigation, guarded automatic return and editor/overview focus intent. |
| `app/useReplyDraft.ts` | Draft revisions and acknowledgement-dependent clearing. |
| `app/run-availability.ts` | Launch/action eligibility and projects protected from deletion. |
| `ui/app/App.tsx` | Screen composition, theme, layout and preview choices. |
| UI feedback components | Native version lookup and rendering model/run notices. |

Project mutations use one operation registry with explicit `requesting` and
`settling` phases. React pending sets are snapshots of that registry, rather than
separately maintained sources of truth. Accepted cancellation waits for project
status confirmation; uncertain deletion waits for presence/absence. The session
still owns replies, interruption and subscriptions. Named methods, expanded JSX
props and an explicit session controller contract replace compressed callbacks.

Validation uses the existing native interaction, navigation, deletion, recovery,
layout and lifecycle scenarios. No test expectations or screenshot baselines are
changed to accommodate the refactor.

After the refactor, all 210 desktop tests and all 13 native backend lifecycle
scenarios passed sequentially against the same build. Desktop lint, all four
TypeScript projects, production build, local documentation links and
`git diff --check` also passed. CI/Full E2E were not run; no PR was requested.
