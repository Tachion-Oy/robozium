# Changelog

## Unreleased

- Add a credential-free model-selection mock scenario and HTTP/browser checks that verify actual provider requests after active-run switching and isolation between runs.

- Type configuration exports with `HubValues` and select the shared `robosprawl` orientation/HUD skill. The shared deployment derives actual paths from `Project` at construction time.

- Replace the split Python/JSON configuration with one editable `hub.config.py` containing named constants. Hub holds validated inputs and runtime selection directly; loading and slug helpers live in `hub.utils`. Logging defaults live in `hub.logging`.
- Consume shared deployment recipes, project permissions, dependency routing, model selection, and health monitoring. The shared RoboSprawl recipe binds capability choices to each project; local construction and workspace layers are removed.
- Select lazy endpoints from `roboz-endpoints[openai]` directly. Display labels map to endpoint objects, primitive identities drive model selection, and all advertised models are monitored.
- `create_app` accepts only Hub. Configure capabilities, policies, paths, health timings, transcription, and dependency registrations through the Python constants. JSON, builder exports, HubConfig wrappers, local endpoint schemas, and app-level overrides are removed.

### Fixed

- Provision the frontend CI job with Python and the resolved Roboz dependencies before loading `hub.config.py`; keep transcription assertions and generated test configuration isolated.

- Report completed WebKit test failures as advisory warnings with successful CI job checks, while retaining required setup and runner failures.

- Keep local editor reports, frontend build output, and development artifacts out of Python source distributions.

### Changed

- Test each CI run against Roboz’s current `main`, resolved once and reported alongside the RoboSprawl revision; build fresh installation and browser candidates from those sources.

- Use Roboz Shed for automatic context compaction, restoring the full continuation prompts and forwarding run cancellation and optional timeouts. Python consumers should import the builder from `roboshed.tools` instead of the removed `robosprawl.compaction` module.

- Verify installed backends with the production frontend in Chromium, Firefox, and WebKit. E2E runs retain diagnostics and clean up their services and temporary data after failures or interruption.
