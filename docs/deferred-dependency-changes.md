# Deferred dependency changes

The original port treated external repositories as read-only. Reusable capabilities now belong in Roboz and its Shed package; this application composes their public APIs.

## Remaining naming cleanup in Roboz

Repository: `Tachion-Oy/roboz`. CI tests its current `main`, resolved once per run.

The historical project prefix remains in Roboz documentation, test fixtures, and the Proton Bridge request-ID email header. The header is defined by `EmailHeader.REQUEST_ID` in `packages/proton-bridge/src/roboz_proton_bridge/protocol.py` (the literal legacy spelling is deliberately not duplicated here).

Proposed external fix: update prose and fixtures independently; migrate the header to `X-Roboz-Request-Id` using dual-read support before changing writes. Existing mailbox drafts carry the old header. An immediate rename would prevent request-ID lookup from recognizing them and could break idempotency or create duplicate drafts. Add tests that find both historical and new headers and define the compatibility period before removal.

Impact on this port: none, because email is deferred and the bridge package is not installed by RoboSprawl.

## Application adaptations

RoboSprawl uses Roboz `Ctx` and direct resources. The removed specialized contexts and `ToolDependency` wrappers are no longer imported. Public tool names remain lowercase snake case.

Roboz leaves workspace layout and orchestration policy to applications. RoboSprawl owns the path, root/background bundle, file-tool policy, and context-compaction composition; the actual Librarian pipeline remains Roboz's `LibrarianConstructor`. The compaction implementation and full continuation prompts are provided by `roboz_shed.tools.get_compactify_messages_when_needed_tool`; RoboSprawl selects the endpoint and 60% threshold and supplies the owning event pipe. `OrchestratorConstructor.compactify_timeout_s` optionally bounds each provider attempt, defaulting to `None`.

## Deferred integrations and their tests

Live transcription returns HTTP 503. Mock transcription retains upload, codec, error, and size-limit tests. Email/signatures, web search, indexed search, office/PDF creation, timesheets, shell execution, containerized coding, and the code-task planner are outside this first port.

Excluded original tests are exclusively integration-specific: email signatures; code-plan creation/reply; timesheet confirmation and deployment binding; coding sandbox checks/policy; provider-specific email, web, indexed-search deployment wiring; web-service authentication; and the default code-planner lineup. General dependency-contract, health-monitor, project, run, cancellation, streaming, file-serving, model-selection, and memory tests are retained and adapted. Deployment tests assert the reduced tool set and credential-free configuration.

No unresolved dependency compatibility blocker has been identified. Credential-backed live inference still requires a separately reported smoke test.

## Browser compatibility

The previously advisory WebKit findings are addressed in application tests:
geometry waits for layout and toast dismissal precedes the polling-stop wait.
Chromium and Firefox gate CI. Completed WebKit test failures are advisory;
setup and runner failures remain required. See [testing](testing.md) for repetition commands
and [verification](verification.md) for local evidence and remaining limits.
No dependency API change is required by these repairs.


## Replaceable model references

`OrchestratorEndpointRoute` implements Roboz's `ExternalDependencyReference`.
It reads its getter once per materialization or inspection. Discovery returns
that selected lazy dependency; materialization delegates to its own identity
validation and client cache. No initial-model identity or metadata is captured.
Request-option wrappers preserve this live selection contract.

Global selection sets the default for future runs. A run-specific selection
changes that run's next model resolution; calls already in flight retain their
endpoint. Switching back reuses the selected model's cached client. Every
selectable model stays in the deployment health catalog. Registration matching,
checkers, scheduling, timeouts, and cached HTTP health responses are unchanged.

The reference API must reach Roboz `main` before this adaptation lands because
Hub CI resolves that branch. Local paired-candidate checks are recorded in
`reference-validation.md`. No versions, dependency ranges, or publication actions
change. The lock refresh records the already-added Roboz development dependency
on PyYAML; it changes no package resolution or compatibility range. Refresh
installed core, Shed, and OpenAI candidates together; Shed already exports the
required compaction tool, so no compatibility shim is needed.
