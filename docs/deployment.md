# Deployment configuration

`hub.config.py` contains the application's editable choices as named `Final`
constants. It contains no builder, schema classes, or runtime helpers. Shared
Roboz and Roboshed primitives supply endpoint definitions and agent construction.

## Ownership

- The configuration file selects named endpoints, request policies, capabilities,
  instructions, interaction mode, specialists, workspace/persistence locations,
  health timings, transcription, and dependency registrations.
- `robosprawl.hub.application.Hub` validates those inputs, derives projects, and
  owns the runtime `ModelSelector`. It does not pick models or capabilities.
- `robosprawl.hub.utils` discovers and loads the file and normalizes project names.
- `robosprawl.hub.logging.HubLoggingConfig` supplies logging defaults. This is the
  explicit exception to requiring deployment choices in the configuration file.
- `roboshed.deployments.robosprawl.RoboSprawl` binds the selected permission
  factories to each project and composes the persistent orchestrator and Librarian.
  `DeploymentFactory` handles fresh runtime construction and live model routing.
- The API consumes Hub and owns HTTP, streaming, interruption, cancellation,
  background-thread observation, and shutdown.

## Editing and loading

Edit the constants directly. `MODELS` maps display labels to lazy endpoint objects;
`DEFAULT_MODEL` refers to one of those endpoints. Stable IDs come from primitives.
`MEMORY_ENDPOINT` has its own request policy and remains independent of model
switching. Each file load creates fresh lazy catalogs; runs within that Hub reuse
its configured clients.

`CAPABILITIES` is an ordered tuple of configured capabilities or factories that
accept `WorkspacePermissions`. For example, `(FileCommands, FileEditing,
Compactification(threshold_percent=60))` binds file capabilities to each project's
permissions while retaining the explicit compaction choice. The selected shared
`robosprawl` skill owns orientation, HUD formatting, and artifact-link guidance. The shared deployment
resolves its project context from the current `Project` when constructing a run,
including configured persistence folders. Configuration does not repeat or pass
back the deployment’s default context template. No paths or artifact-link syntax are repeated
in the skill selection.

`LOGGING = HubLoggingConfig()` keeps the normal console/file behavior. Override
individual fields, such as `console_level` or `max_bytes`, when needed. The default
technical-log path is `.runtime/logs/backend.jsonl` relative to the selected file.

```python
from robosprawl.api.app import create_app
from robosprawl.hub.utils import load_hub

app = create_app(deployment=load_hub())
```

An explicit `load_hub(config_file=...)` path wins over the environment.
`ROBOSPRAWL_CONFIG` selects a file when no explicit starting directory is supplied;
otherwise discovery searches the starting directory and its parents for
`hub.config.py`. Loading executes the file in a fresh namespace and requires its
named configuration constants described by the `HubValues` TypedDict. Its keys
and value types are checked statically in the loader; Hub retains runtime
validation. Errors identify the selected file and retain their
cause. No JSON schema, builder export, nested HubConfig, or checkout fallback is
supported.

Workspace and technical-log paths are anchored to that file. Persistence folder
names stay project-relative and disjoint. Existing folder values are preserved;
no user data moves. The host creates directories and `ProjectService` validates
startup layout. Shared `Project.permissions` allows workspace reads and project
writes, asks for shared writes, and denies other writes.

Custom deployments implement the shared `RunFactory` contract and are supplied as
`DEPLOYMENT`. Python hosts and mocks can use `dataclasses.replace(hub, ...)` to
supply explicit typed inputs before app construction. No app-level configuration
overrides exist. Automatic inspection includes constructed agents, every
advertised model, and transcription. Explicit registrations must match dependency
IDs and kinds exactly; custom kinds require explicit checkers.

## Behavior and verification

The checked-in choices retain API interaction, 60% compaction without an explicit
timeout, independent root/memory reasoning, and the shared persistent prompt.
Librarian snapshots, consolidation, retention, and 120-second cadence remain in
shared deployment code. Construction starts no agents or threads and creates no
persistence directories. Mocks retain fresh scripts and their existing scenario
controls.

The full local gates have now run against merged Roboz `303384e`. See
[deployment validation](deployment-validation.md) for results, the artifact-read
assertion correction, browser policy, source revisions, and retained diagnostics.

## Current code accounting

Against RoboSprawl baseline `b68a8d1`, including the root Python configuration as
production code and excluding generated files, locks, documentation, and binaries:

| Scope | Additions | Deletions | Net |
| --- | ---: | ---: | ---: |
| Production Python | 639 | 2,247 | -1,608 |
| Total maintained code | 1,880 | 3,890 | -2,010 |
