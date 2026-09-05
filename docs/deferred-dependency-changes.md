# Deferred dependency changes

The original port treated external repositories as read-only. Reusable capabilities now belong in Roboz and its Shed package; this application composes their public APIs.

## Remaining naming cleanup in Roboz

Repository: `Tachion-Oy/roboz`, pinned at `4e531215c69aec42e82af24e47f06c871b896f82`.

The historical project prefix remains in Roboz documentation, test fixtures, and the Proton Bridge request-ID email header. The header is defined by `EmailHeader.REQUEST_ID` in `packages/proton-bridge/src/roboz_proton_bridge/protocol.py` (the literal legacy spelling is deliberately not duplicated here).

Proposed external fix: update prose and fixtures independently; migrate the header to `X-Roboz-Request-Id` using dual-read support before changing writes. Existing mailbox drafts carry the old header. An immediate rename would prevent request-ID lookup from recognizing them and could break idempotency or create duplicate drafts. Add tests that find both historical and new headers and define the compatibility period before removal.

Impact on this port: none, because email is deferred and the bridge package is not installed by RoboSprawl.

## Application adaptations

Roboz renamed `Agent`, `FactoryCtx`, `SubagentCtx`, `prompt_user_at_start`, and the `custom_prompt_user_tool` constructor argument, and validates public tool names as lowercase snake case. RoboSprawl uses those public names directly. Its tests now give tool functions valid public names.

Roboz leaves workspace layout and orchestration policy to applications. RoboSprawl owns the path, root/background bundle, file-tool policy, and context-compaction composition; the actual Librarian pipeline remains Roboz's `LibrarianConstructor`. The compaction implementation and full continuation prompts are provided by `roboz_shed.tools.get_compactify_messages_when_needed_tool`; RoboSprawl selects the endpoint and 60% threshold and supplies the owning event pipe. `OrchestratorConstructor.compactify_timeout_s` optionally bounds each provider attempt, defaulting to `None`.

## Deferred integrations and their tests

Live transcription returns HTTP 503. Mock transcription retains upload, codec, error, and size-limit tests. Email/signatures, web search, indexed search, office/PDF creation, timesheets, shell execution, containerized coding, and the code-task planner are outside this first port.

Excluded original tests are exclusively integration-specific: email signatures; code-plan creation/reply; timesheet confirmation and deployment binding; coding sandbox checks/policy; provider-specific email, web, indexed-search deployment wiring; web-service authentication; and the default code-planner lineup. General dependency-contract, health-monitor, project, run, cancellation, streaming, file-serving, model-selection, and memory tests are retained and adapted. Deployment tests assert the reduced tool set and credential-free configuration.

No unresolved dependency compatibility blocker has been identified. Credential-backed live inference still requires a separately reported smoke test.

## Browser compatibility

The previously advisory WebKit findings are addressed in application tests:
geometry waits for layout and toast dismissal precedes the polling-stop wait.
All three browsers now gate CI. See [testing](testing.md) for repetition commands
and [verification](verification.md) for local evidence and remaining limits.
No dependency API change is required by these repairs.
