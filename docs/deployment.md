# Deployment configuration

`hub.config.py` contains the application's editable choices as named `Final`
constants. It contains no builder, schema classes, or runtime helpers. Shared
Roboz and Roboshed primitives supply endpoint definitions and agent construction.

## Ownership

- The configuration file selects named endpoints, request policies, capabilities,
  interaction mode, specialists, one sandbox layout,
  health timings, transcription, and dependency registrations.
- `robosprawl.hub.application.Hub` validates those inputs, derives projects, and
  owns the runtime `ModelSelector`. It stores the configured deployment getter
  and supplies runtime inputs without knowing the agent recipe.
- `robosprawl.hub.utils` discovers and loads the file and normalizes project names.
- `robosprawl.hub.logging.HubLoggingConfig` supplies logging defaults. This is the
  explicit exception to requiring deployment choices in the configuration file.
- `Hub.configure_deployment()` creates a fresh scoped Sandbox and invokes the
  stored getter with the project slug, model getter, and event sinks.
- `roboshed.deployments.robosprawl.RoboSprawl` owns the concrete agent recipe:
  the orchestrator, Librarian, recursive foreground names, and initial messages.
  Shared `Deployment.build()` builds runtime agents and persistence sinks.
- The API consumes Hub and owns HTTP, streaming, interruption, cancellation,
  background-thread observation, and shutdown.

## Editing and loading

Edit the constants directly. `MODELS` maps display labels to lazy endpoint objects;
`DEFAULT_MODEL` refers to one of those endpoints. Stable IDs come from primitives.
`MEMORY_ENDPOINT` has its own request policy and remains independent of model
switching. Each file load creates fresh lazy catalogs; runs within that Hub reuse
its configured clients.

`CAPABILITIES` is an ordered tuple of additional root capabilities: the shared
`robosprawl` orientation/HUD skill and `Compactification(threshold_percent=60)`.
The shared orchestrator already supplies file commands and editing, each taking
only a `PermissionPolicy` derived from the run's Sandbox. Do not add duplicate
file capabilities here. `SUBAGENTS` holds shared `DeployableAgent` definitions.

The configuration constructs its deployment getter explicitly:

```python
from roboshed.deployments.robosprawl import RoboSprawl

DEPLOYMENT = RoboSprawl(
    memory_endpoint=MEMORY_ENDPOINT,
    additional_capabilities=CAPABILITIES,
    subagents=SUBAGENTS,
    interaction_mode=INTERACTION_MODE,
)
```

Hub loads only `DEPLOYMENT` for agent configuration. The four constants above are
helpers used to construct that object; they are not required Hub exports.
The recipe supplies the memory directory and generated project locations
through the orchestrator's `initial_messages`. The shared system prompt
is used unchanged. Project locations come from the same scoped Sandbox used for
file permissions, the Librarian, and the Deployment.

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

Sandbox and technical-log paths are anchored to that file. The single `SANDBOX`
constant owns tier names and persistence folder names; persistence stays
project-relative and disjoint. The checked-in configuration places its sandbox
at `../RoboSprawl`, outside the checkout; it does not move data from the former
`.runtime/data` root automatically. Tier and persistence folder names are
preserved. The host creates directories and `ProjectService` validates startup
layout. `sandbox.permissions()` is the sole policy source: it allows
sandbox reads and current-project writes, asks for shared writes, and denies
other writes.

`SANDBOX` is a layout template. `Hub.project()` uses `for_project(slug)` to derive
project paths; `Hub.configure_deployment()` takes a fresh scoped copy for each
independent run, including repeated runs of the same project. Permissions and
graph construction use that instance throughout. It is never re-scoped during
the graph's lifetime. File tools receive only its derived policy. Project
symbolic-link aliases fail before graph construction.

Python hosts and mocks can use `dataclasses.replace(hub, ...)` to supply explicit
inputs before app construction. The required `deployment` callable receives
the fresh scoped Sandbox, matching project slug, endpoint getter, and event
sinks, and returns an unbuilt shared Deployment. Mocks supply a different
callable through the same field. The host calls
`build()` and owns the resulting root/background agents. No app-level
configuration overrides exist. Automatic inspection includes constructed agents,
every advertised model, and transcription. Explicit registrations must match dependency
IDs and kinds exactly; custom kinds require explicit checkers.

## Behavior and verification

The checked-in choices retain API interaction, 60% compaction without an explicit
timeout, independent root/memory reasoning, and the shared persistent prompt.
Librarian snapshots, consolidation, retention, and 120-second cadence remain in
the shared Librarian preset. Construction starts no agents or threads and creates no
persistence directories. Mocks retain fresh scripts and their existing scenario
controls.

The dependency pins select Roboz `0.1.2.dev3` and Roboshed `0.1.1.dev1`.
The published Shed development snapshot includes the `RoboSprawl` recipe, so
locked installation and CI consume it directly from PyPI. No sibling checkout
or local dependency paths are required.

[Earlier deployment validation](deployment-validation.md) records the previous
integration against Roboz `303384e`, not this change.
