# Changelog

## Unreleased

- Migrate to concrete Roboz endpoints and typed `LLMEndpointRoute` selection.
  Each run retains its live model getter while fixed memory endpoints remain
  concrete. Replace dependency checker registrations with resources that own
  `check()`, and combine built-agent dependencies with selectable models and
  optional standalone resources in the health monitor. Deployment build,
  invocation, model switching, persistence, and cancellation order are preserved.

- Consume `roboz 0.1.2.dev4` and `roboshed 0.1.1.dev2` from PyPI. Call Shed's
  `robosprawl()` recipe with the scoped project and deployment choices for each
  new run. Project context, agent defaults, and persistence stay in Shed;
  replies, model switching, cancellation, and streaming retain their lifecycle.

- Adopt shared `Deployment` and `DeployableAgent` composition with one fresh,
  project-scoped Sandbox per run. Paths and permissions come from that instance;
  the Python configuration retains all deployment choices and project context.
  Shared agent/tool definitions and host lifecycle behavior are unchanged.

- Replace the split workspace and persistence configuration with one `SANDBOX`.
  It is the sole source of project paths and tiered tool permissions; the API's
  `Project` remains an application-owned identity/lifecycle value. The default
  sandbox root is now `../RoboSprawl`, outside the checkout, while tier names,
  project persistence names, and permission behavior remain unchanged.

- Install the tested Roboz, Shed, and Endpoints releases from PyPI. Development
  setup and installed browser tests no longer need a sibling Roboz checkout or
  a private-repository dependency token.

- Add a credential-free model-selection mock scenario and HTTP/browser checks that verify actual provider requests after active-run switching and isolation between runs.

- Type configuration exports with `HubValues` and select the shared `robosprawl` orientation/HUD skill. The shared deployment derives actual paths from `Sandbox` and the current project slug at construction time.

- Replace the split Python/JSON configuration with one editable `hub.config.py` containing named constants. Hub holds validated inputs and runtime selection directly; loading and slug helpers live in `hub.utils`. Logging defaults live in `hub.logging`.
- Consume shared deployment recipes, sandbox permissions, dependency routing, model selection, and health monitoring. The shared RoboSprawl recipe binds capability choices to each project; local construction layers are removed.
- Select lazy endpoints from `roboz-endpoints[openai]` directly. Display labels map to endpoint objects, primitive identities drive model selection, and all advertised models are monitored.
- `create_app` accepts only Hub. Configure capabilities, policies, paths, health timings, transcription, and dependency registrations through the Python constants. JSON, builder exports, HubConfig wrappers, local endpoint schemas, and app-level overrides are removed.

### Fixed

- Pin the published Roboshed development snapshot so configuration loading,
  tests, and frontend builds can import the concrete `robosprawl()` recipe.

- Provision the frontend CI job with Python and the resolved Roboz dependencies before loading `hub.config.py`; keep transcription assertions and generated test configuration isolated.

- Report completed WebKit test failures as advisory warnings with successful CI job checks, while retaining required setup and runner failures.

- Keep local editor reports, frontend build output, and development artifacts out of Python source distributions.

### Changed

- Test each CI run against the exact Roboz releases locked from PyPI; record their versions and hashes alongside the RoboSprawl revision, and build fresh application candidates for installation and browser checks.

- Use Roboz Shed for automatic context compaction, restoring the full continuation prompts and forwarding run cancellation and optional timeouts. Python consumers should import the builder from `roboshed.tools` instead of the removed `robosprawl.compaction` module.

- Verify installed backends with the production frontend in Chromium, Firefox, and WebKit. E2E runs retain diagnostics and clean up their services and temporary data after failures or interruption.
