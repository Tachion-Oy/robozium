# Frontend runtime review

This review records runtime risks found before the frontend structure refactor. They are intentionally left as follow-up work: this change reorganizes ownership and preserves behavior.

## Stale polling responses can overwrite newer run state

`startRunSessionPoller` starts a request immediately and starts another every two seconds without tracking an in-flight request or response generation (`web/lib/robozium/session/poller.ts:11`). If one request takes longer than a later request, the older response can dispatch last. The HUD reducer accepts both poll snapshots, so the late response can restore an older status, prompt, or agent after a newer snapshot or stream event was already applied.

Reproduce by delaying one `GET /api/runs/:id` response beyond the next polling interval, allowing the next request to return first, and giving the delayed response older run data. Observe the older snapshot being dispatched after the newer one.

Follow-up work should serialize polling or reject responses older than the most recently started/applied request, with a test that resolves two requests in reverse order.

## Failed refreshes and reply submissions are handled inconsistently

Project polling replaces the visible project rows with an empty array after a transient `listProjects` failure (`web/app/components/hud/projects/useProjectOverview.ts:83`). Cancel and delete operations always request another refresh (`web/app/components/hud/projects/ProjectOverview.tsx:89` and `web/app/components/hud/projects/ProjectOverview.tsx:106`), so a failed refresh can make otherwise valid projects disappear. Other request failures retain the current UI and show an error.

Reply submission is the inverse inconsistency: `submitReply` allows the API exception to escape (`web/lib/robozium/session/index.ts:87`), while `RunHud` only resets its local pending flag in `finally` (`web/app/components/hud/run/RunHud.tsx:75`). The draft remains, but the user gets no submission-specific toast or inline error. Cancel, interrupt, dependency, project-create, project-cancel, and project-delete paths do provide explicit failure feedback.

Reproduce the project case by loading at least one project, then failing the next `GET /api/projects`; the overview becomes `No projects`. Reproduce the reply case by rejecting `POST /api/runs/:id/replies`; the Send button becomes available again without explaining the failure.

Follow-up work should preserve the last successful project list on transient refresh failures and define one consistent user-visible request-error policy for reply submission.

## Snapshot normalization generates hydration-sensitive timestamps

`runViewTraceToLogItems` assigns `new Date().toISOString()` while normalizing a run snapshot (`web/lib/robozium/stream.ts:343`). The same snapshot can therefore produce different `receivedAt` values when rendered on the server and normalized again on the client. Any rendered or ordering-sensitive use of that field can produce a hydration mismatch or nondeterministic initial state.

Reproduce by normalizing the same run view on the server and client with different clocks (or a delay between them), then compare the generated log items. Their `receivedAt` fields differ even though the wire snapshot is identical.

Follow-up work should carry a stable server timestamp in the wire data or inject one normalization timestamp and preserve it across the server/client boundary.

## Baseline validation reviewed

The pre-refactor verification recorded in `docs/verification.md` on 2026-09-05 was:

- Frontend unit tests: 310 passed across 42 files.
- ESLint: passed (reported together with Ruff).
- Chromium E2E: 36 passed; both visual scenarios passed with snapshot updates disabled.
- Firefox E2E: 34 passed.
- WebKit advisory run: 32 passed and 2 failed in known pointer/toast timing scenarios.

Those results establish the behavior and visual baselines this structural change is expected to preserve.
