# PR 8 — Desktop run creation and live output

## Result and scope

Implemented locally on `feat/desktop-run-output` in
`/tmp/robozium-desktop-run-output`, based on remote `main` at
`673d3616562d1ddcd975d9a5aad2809de4e93fc5` (merged #94). [CI](https://github.com/Tachion-Oy/robozium/actions/runs/39034239794) and
[Full E2E](https://github.com/Tachion-Oy/robozium/actions/runs/39034239922)
both passed on that base before implementation. The clean `experiment/electron`
checkout remains the visual reference. The worktree is locked against pruning.

Connected Runs Overview starts the selected project through `POST /run/create`
with only `{ project }`, using the acknowledged default model and backend
capability defaults. Model changes continue to affect future runs. Creation is
guarded against duplicate submissions and model writes, has a ten-second deadline,
and never retries automatically. A failed or timed-out creation stays in overview.
The independent `--preview` workflow retains its existing local fixture history.

## Ownership and presentation

All `.tsx` components and their CSS live under `ui/`, grouped by feature; the
entry point is `ui/main.tsx`. TypeScript hooks, APIs and state remain outside
`ui/`. `ui/app/App.tsx` composes backend, project, model and session state; the
session coordinates sibling `run/` and `hud/` folders. Shared request
infrastructure remains in `api/`. Dependencies flow from UI components to feature
state; TypeScript feature modules do not import UI components. Run reconciliation
has no HUD dependency. The desktop README gives the
complete [renderer layout](../../desktop/README.md#code-layout).

- `app/navigation.ts` owns real destinations and `app/preview.ts` owns standalone
  mock choices/messages. App supplies navigation options to the HUD header, which
  no longer reads fixture data. HUD components and styles live in `ui/hud/`;
  message projection remains in `hud/`. Status labels belong to HUD projection,
  while backend statuses remain in run contracts.
- `api/client.ts` handles generic JSON requests and `streamEvents(path, signal)`.
  It owns HTTP policy and SSE decoding; endpoint paths and domain validation
  belong to the feature APIs. `run-api.ts` constructs the encoded stream path.

- `run/run-contracts.ts` names the consumed event, status, role and runtime-control
  values, with derived types shared by parsing and the desktop reducers. The
  desktop-local constants adapt the browser wire definitions without dependencies.
- `run/run-api.ts` exposes typed operations for creation, snapshots and streamed
  events using the existing direct client. `run/run-payloads.ts` validates unknown
  payloads and normalizes consumed fields. Snapshots and SSE share one event
  decoder; message content remains uninterpreted until HUD projection.
  Future/unconsumed event kinds are ignored. No dependencies, IPC methods,
  backend endpoints, or shared packages were added.
- `api/request.ts` owns the shared request deadline, timeout translation and
  timer cleanup. Selection reads/writes, run creation/snapshots and readiness
  polling reuse it. Request owners retain cancellation and stale-result guards;
  readiness uses three seconds and other requests default to ten seconds.
- `projects/useProjects.ts` and `models/useModels.ts` keep the two domain hooks separate.
  They share `api/useRequest.ts` for pending/error state, cancellation and stale
  response guards; the shared hook delegates deadlines to `api/request.ts`.
  `projects/projects-api.ts` and `models/models-api.ts` replace the mixed selection
  adapter. Each keeps its small contracts, validation and requests together;
  malformed data, duplicate identifiers and mismatched acknowledgements retain
  their existing behavior. The project panel in `ui/projects/` consumes the hook's
  typed state and actions.
- `session/useRunSession.ts` is instantiated once by App. It owns creation,
  the captured run/project, reducer state and subscription disposal. View changes
  retain this session. Explicitly opening another run aborts obsolete local work
  without cancelling the backend run. Generation checks ignore disposed callbacks.
- `run/run-updates.ts` exports `watchRun()` for one run's SSE and snapshots.
  Private functions in this module separately consume typed events, serialize
  snapshot reads, check the captured project, and schedule polling. They share
  a connection lifetime; payload validation remains in the run API boundary.
  The poller is created idle, so its stop handle exists before callbacks are wired
  and either background task starts. Cleanup does not rely on asynchronous timing.
  Opening SSE starts the prepared run. Snapshots begin immediately, then poll
  two seconds after each read settles, with ten-second deadlines. Stream closure
  and HTTP 409 trigger a fresh snapshot after any pending read. Terminal snapshots
  stop owned requests; completed output remains readable. Errors stop the
  subscription and retain content. Retry disposes old work and reconnects only
  the known ID; it cannot interrupt a pending replacement creation.
  Stream closure stops scheduled polls, waits for any in-flight snapshot, and
  requests a fresh view before reporting disconnection. Snapshot delivery happens
  before the next reader proceeds, so a terminal view can dispose the connection.
- `run/run-reducer.ts` owns identity, status, the authoritative prompt,
  recorded events and deduplication. It has no HUD dependency or display rules.
  Recovery merges by sequence membership so delayed snapshots cannot drop older
  history behind SSE. A separate ordered-SSE cursor deduplicates tokens without
  letting an overtaking snapshot discard a streamed prefix. Chunk deduplication
  also survives removal of live text from the HUD. Token chunks stay transient;
  only completed messages and other backend records enter `events`.
  Each reduction returns accepted updates alongside the next run state. Replayed
  records remain in those updates so consumers can apply their presentation effects.
- `session/session-reducer.ts` composes `{ run, hud }` in one atomic update.
  Backend actions flow through run reconciliation before HUD projection; history
  selection touches only HUD state. `selectRunDisplay()` joins presentation with
  authoritative run status and prompt data for App and navigation.
- `hud/hud-reducer.ts` coordinates completed history, the cached message
  view, live/settling text and explicit history pinning. It reads run status and
  prompt data without storing a second copy. Named helpers own history projection
  and view composition; the reducer handles accepted updates and selection.
  Provider retries clear only matching transient output, including settling
  text. Ordinary agent completions keep progress visible until subsequent output
  or a prompt replaces it. Snapshots independently update status and prompts.
  New prompts record script boundaries after the snapshot's captured sequence;
  repeated polls do not move them, and subsequent recovery preserves them.
  Streamed attempts also record display boundaries here, without synthetic run
  events. Older recovered output respects those boundaries during regrouping.
- `hud/hud-history.ts` projects completed records and groups literal script
  output. Live append and snapshot recovery share the same event rules. Normal
  events append incrementally; recovery rebuilds the compact history and preserves
  script identities without mutating previous entries.
  Each script keeps its original identity anchor even when recovery supplies an
  earlier prefix or splits a group. Rebuilt groups claim each identity only once.
- `hud/hud-view.ts` composes completed history with the active prompt,
  retains pinned prompt entries and returns an explicitly typed display result.
  Active prompts take precedence over later background notifications; latest
  navigation returns to the prompt while other entries remain readable.
  Token updates leave the cached message list unchanged.
- `hud/hud-messages.ts` defines distinct agent, prompt and script display
  types; only script messages carry grouping sequences and identity anchors.
  Stateless helpers extract user notifications, `prompt_user` content and errors,
  create or extend typed script messages, and apply cosmetic token cleanup.

Incremental text scrolls down, while changing the selected entry resets scroll.
Existing divider, draft, clipboard and preview visuals remain in place.

Replies, cancellation/interrupt controls, automatic reconnection, and recovery
following app reopen remain PR 9. Draft editing is local. Rich Markdown and
artifact-link rendering remain tracked presentation parity work.

Uniform output handling is a separate follow-up. Model deltas have a message ID
and a completed replacement; script chunks are retained records with a sequence
and text, without a group ID or matching completion. The HUD groups script chunks
into display entries and preserves their identities across recovery. A common
output contract with stable identities and explicit boundaries could simplify
this, but the current increment retains the existing event contracts and behavior.

## Copied sources and adaptations

All browser sources were read at `673d3616562d1ddcd975d9a5aad2809de4e93fc5`:

| Browser source | Desktop adaptation |
| --- | --- |
| `web/lib/robozium/client.ts`, `wire.ts` | Minimum creation/snapshot/event contracts; desktop-local named constants and derived types, direct paths and runtime validation without Zod or Next.js. |
| `web/lib/robozium/stream.ts`, `streaming-text.ts` | User-facing message extraction, literal script grouping, delta identities, and cosmetic partial-JSON cleanup. Omit log metadata and rich rendering. |
| `web/lib/robozium/session/reducer.ts`, `hud-reducer.ts`, `reducer.types.ts` | Separate run and HUD reducers, scoped provider retry resets, settling and stable history selection. Adapt presentation to the desktop's single-message panel. Recover durable events by sequence membership; keep token accumulation incremental. Omit notifications and reply/cancel state. |
| `web/lib/robozium/session/connection.ts`, `poller.ts`, `snapshot.ts` | Subscription ownership, immediate and serialized snapshot reads, and terminal reconciliation. Use fixed ten-second deadlines and explicit retry; omit automatic reconnect/backoff and browser route exit. |
| `web/lib/robozium/hud-messages.ts` | One desktop selector for pinned history, active prompt, live/settling text, then latest completed content. Shared current-entry selection drives the existing panel, footer and clipboard. |

The desktop hook and launch integration are local additions. The renderer
production diff is **1,736 changed lines** (1,394 additions, 342 removals), measured
against the base with rename detection across renderer source. This includes
adapted source, CSS, hook separation and import changes from feature grouping;
unchanged relocated contents are not counted as additions/removals. Tests and
documentation are counted separately. No lockfiles or binary assets changed.

## Verification

Native run scenarios use real HTTP/SSE test boundaries and the built Electron
renderer. They cover duplicate/rejected/timed-out creation, malformed data,
snapshot/stream overlap, duplicate events/chunks, completed messages, prompt-only
updates, terminal states, explicit retry, view retention, old-session disposal,
late responses, empty/growing history, script output, pinned selections, streaming
scroll, clipboard, drafts, keyboard focus, both themes and narrow 125% zoom.
Review regressions add provider retry followed by success, active prompts before
background notifications, explicit pinning/latest navigation, and settling through
polling. Further native regressions cover navigation/copy after prefix recovery
splits a script group, duplicate events dismissing delayed tokens, and pinned
scripts remaining separate across a prompt. Twenty-five direct reducer tests cover
replay suppression, retry scoping, snapshot/SSE races, recovered script boundaries,
prompt replacement and immutable prior states. They include delayed/status-only
prompt snapshots, repeated polls and older duplicates preserving newer live text.
A 100,000-token case retains 100 run records for 100 completed messages, with
100 display boundaries held separately in the HUD. Subsequent tokens leave
completed history untouched. New separation regressions exercise the run reducer
without a HUD, selection independence, recovery before a live display boundary,
and duplicate chunks arriving after script output cleared the live presentation.
Mixed-content cases verify that SSE and recovered history apply identical
message extraction and script grouping rules, including hidden agent messages.
Before the ownership refactor, a reducer-only probe processed 1,000 further deltas against 100, 10,000,
and 100,000 recovered messages in approximately 1–4 ms per batch. These local
timings exclude rendering and are observations, not a CI timing threshold.
The request-helper tests use controlled timers to check cleanup, cancellation
reasons, deadlines and late success. API contract tests use literal wire fixtures
to check event normalization, role/status validation and future-event handling.
The typed stream wrapper is also checked for response cleanup on early exit,
abort and malformed consumed payloads.

The Docker native suite creates/selects a project through the UI, starts its run,
observes both mock prompts and completion, and retains history and drafts. Test
helpers submit required replies through HTTP. Outage checks now preserve real run
output instead of preview fixtures. Run the UI and backend suites against a fixed
build; concurrent builds can remove renderer assets during another suite's launch.

Local validation passed:

- Desktop lint, all TypeScript projects, and production build.
- All 144 desktop tests after the complete renderer grouping and API separation, including 30
  native run scenarios and 25 direct reducer tests. Existing preview screenshot
  baselines passed unchanged in both themes, narrow windows and 125% zoom.
- After the final TSX/CSS relocation into `ui/`, lint, types, build and the native
  bundled-assets scenario passed. All built renderer assets and TypeScript logic
  files are byte-identical to the preceding version; full native/Docker suites
  were not repeated for this move.
- The two focused native Docker scenarios after feature grouping and API
  separation: renderer HTTP/SSE against the selected backend under CSP, and UI
  project creation, run launch, both prompts and completed history.
- Earlier in this increment, all 13 staging/Compose checks, 34 backend lifecycle
  unit tests, 11 native Docker scenarios and the disposable Docker restart smoke
  passed. The remaining backend checks were not repeated for the renderer
  refactors; backend runtime code is unchanged.
- Independent desktop-only build without browser or Python source inputs,
  using the earlier fresh locked installation with the revised sources, before
  the final UI file relocation.
- `git diff --check`, new-file whitespace checks, and local documentation links.

The first full native run overlapped a backend-suite build and failed one launch
with `ERR_FILE_NOT_FOUND` while Vite replaced the shared renderer assets. Running
against fixed built assets passed the full suite; no assertions or timeouts were
weakened. Shell-sandbox process restrictions also required running the native and
Docker checks outside that shell sandbox, retaining Electron's Chromium sandbox.
The contract/deadline checks also encountered the shell sandbox's loopback-listen
restriction (`EPERM`); HTTP/native tests require the same outside-sandbox runner.

Full repository Python/browser checks and Full E2E run in CI for the PR. All
required checks, including Full E2E, must pass on its latest commit before
handoff or merge. Merging requires a separate request.
