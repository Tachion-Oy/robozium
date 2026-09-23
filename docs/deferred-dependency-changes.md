# Deferred dependency changes

The original port treated external repositories as read-only. Reusable capabilities now belong in Roboz and its Shed package; this application composes their public APIs.

## Shared APIs

CI resolves the RoboZ version pinned in `uv.lock`. The integrated Endpoints inventory supplies model catalogs; Robozium does not maintain provider metadata.

Robozium selects configuration and capabilities and hosts the runtime. RoboZ
owns agent definitions, typed endpoint routes, sandbox policies, reusable
capabilities, persistent agent presets, and deployment construction.
Tool factories bind concrete typed contexts. See
[deployment composition](deployment.md) for the current interface.

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
