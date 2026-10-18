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
