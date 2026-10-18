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
