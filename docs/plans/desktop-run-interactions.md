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
runs stop run requests, return Current Run to Overview and clear the saved run
identity. Drafts, existing selection and local history survive for explicit
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
| Reopen/missing run | Browser routing controls entry and exits permanent failures. | Saved terminal runs reopen as history; confirmed missing runs return Current Run to Overview, forget the saved ID and retain the draft for explicit relaunch. |
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
| `projects/useProjectManagement.ts` | Project collection: listing/polling, creation, deletion and removal focus. |
| `projects/useProjectDeletion.ts` | DELETE request lifetimes, uncertain outcomes and suppression of stale deleted rows. |
| `app/useProjectWorkspace.ts` | Project selection, launch/open actions, cancellation and recovery coordination. |
| `projects/useProjectCancellation.ts` | Cancellation request lifetimes and settlement from project status, shared across views. |
| `session/useRunSession.ts` | Public run controller composing lifecycle and interactions. |
| `session/useRunLifecycle.ts` | Launch, restore, close and subscription ownership; invalidate obsolete run lifetimes. |
| `session/useRunInteractions.ts` | Reply/interruption requests bound to the current run lifetime. |
| `app/useRunNavigation.ts` | Explicit navigation, guarded automatic return and editor/overview focus intent. |
| `app/useReplyDraft.ts` | Draft revisions and acknowledgement-dependent clearing. |
| `app/run-availability.ts` | Launch/action eligibility and projects protected from deletion. |
| `ui/app/App.tsx` | Screen composition, theme, layout and preview choices. |
| UI feedback components | Native version lookup and rendering model/run notices. |

This is layered architecture organized by domain responsibilities. Collection
management owns creation/deletion, while the workspace owns selection and work
within existing projects. Request helpers implement those operations without
dictating the public ownership boundaries. Cancellation and deletion each keep
an explicit `requesting`/`settling` registry and publish pending UI snapshots.
The workspace supplies a local-work guard to management; accepted cancellation
must settle before deletion becomes available. Creation/deletion notifications
update selection and dispose only matching sessions.

Run lifecycle management owns an abort signal for the displayed session.
Reply/interruption requests inherit that signal, so replacements, closure and
subscription disposal reject late results immediately. Replacement creation has
its own request lifetime. Run/HUD reducers and the snapshot/SSE watcher retain
their existing responsibilities and transport behavior.

The extracted hooks and eligibility helpers declare named return interfaces for
workspace state, navigation, drafts, project management and action availability.
Their callback signatures distinguish synchronous actions from awaited results.
Components also declare their rendered output type.

Validation uses the existing native interaction, navigation, deletion, recovery,
layout and lifecycle scenarios. No test expectations or screenshot baselines are
changed to accommodate the refactor.

After the initial readability refactor, all 210 desktop tests and all 13 native backend lifecycle
scenarios passed sequentially against the same build. Desktop lint, all four
TypeScript projects, production build, local documentation links and
`git diff --check` also passed. CI/Full E2E were not run; no PR was requested.

The return-contract follow-up passed lint, all four TypeScript projects, the
production build and `git diff --check`. Its ten source files emit identical
JavaScript before and after the annotations, so native suites were not rerun.

The domain-ownership refinement passed all 213 desktop tests and all 13 native
backend lifecycle scenarios sequentially against the final build. New coverage
checks cancellation of an unselected project during unrelated creation, disposal
of pending replies/interruption when switching runs, and Overview cancellation
eligibility while an old run snapshot lags behind confirmed project status.
Lint, all four TypeScript projects, production build, explicit module-boundary
typing audit, local documentation links and `git diff --check` passed. Existing
screenshot baselines remain unchanged. CI/Full E2E were not run; no PR was requested.

## Coordination review

Controlled response ordering reproduced three defects: a consumed-prompt snapshot
before reply acknowledgement retained already-sent text; reopening history during
DELETE left Current Run without a session; and delayed creation overrode newer
navigation. The launch behavior also exists at the implementation base `072341b`.
Control cases confirmed that edits during submission and deletion while viewing
Environment already behaved correctly.

Reply results now report acknowledgement separately from whether the submitted
prompt is current, consumed or replaced. Draft ownership retains the revision
check and ignores replacement/obsolete results. Project removal carries its focus
destination to the workspace, which coordinates confirmed session closure with
navigation. Launch navigation uses a captured revision, so leaving and returning
to the same view also supersedes an earlier launch. Recovery exposes a named
return contract. Request retries, transport parsing and run/HUD reconciliation
remain with their existing owners.

Validation: the six controlled cases first reproduced four failures (consumed
prompt, displayed deletion, and both late-launch navigation cases) while the two
preservation controls passed. After the fixes, all 12 focused regressions passed,
then all 218 desktop tests and 13 native backend scenarios passed sequentially
against the final build. Lint, all four TypeScript projects, production build,
explicit module-boundary typing audit, 23 local documentation links and
`git diff --check` passed. CI/Full E2E were not run; no PR was requested.

## Restart recovery review

The backend stores run controls in a process-local registry. Desktop shutdown
stops its owned backend, so the saved run ID can be absent on reopen even while
the project files survive. Recovery previously kept Current Run open and kept
saving that invalid ID, repeating the failure on every reopen.

Confirmed absence now ends the lifecycle request scope, returns Current Run to
Overview and removes only the saved run reference. Drafts, existing project
selection and local history survive. Later reloads no longer request the missing
ID, and starting another run remains explicit. A delayed missing-run response
preserves a newer choice of view. Temporary errors retain the saved identity and
continue read recovery.

Ending the request scope also aborts pending replies/interruption. A late reply
failure can no longer dispatch a retry that makes the missing run look available
again; a late acknowledgement cannot clear its retained draft.

Validation first reproduced the missing-run navigation/storage failures and the
pending-reply lifetime failure. The final build passed all 221 desktop tests and
13 native backend scenarios sequentially. The real outage test now checks editor
identity while disconnected, then the missing-run fallback and explicitly reopened
history after restarting the backend. Native close/reopen also checks retained
files, image reuse, cleared recovery identity and the draft in an explicit new run.
Fallback captures were inspected in both themes at 900×600 and at 640×420 with
125% zoom. Lint, all four TypeScript projects, production build, 56 local
documentation links and `git diff --check` passed. CI/Full E2E were not run; no PR
was requested.
