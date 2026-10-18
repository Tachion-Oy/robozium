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
- All 186 desktop tests, including unchanged preview screenshot baselines, both
  themes, narrow layouts, 125% zoom, keyboard focus and subscription cleanup.
  The final creation/deletion guard also passed all 33 project, selection and
  recovery scenarios on the rebuilt renderer.
- The 12 native backend lifecycle scenarios and the added real Enter/Send reply
  scenario. Cancellation/deletion and replies were checked again on final assets.
  Reported native results use fixed build assets and sequential suites.
- All 34 controller lifecycle tests, 13 staging/Compose checks and the isolated
  Docker startup/restart/persistence smoke test.
- All 149 applicable Python desktop-access, API, project and run-manager tests.
- Local documentation links resolve; no dependency lockfiles or preview baselines
  changed. The original checkout and other worktrees remain intact.

No PR was opened or pushed. CI and Full E2E remain required before any later PR
handoff or merge; these local results do not replace them.
