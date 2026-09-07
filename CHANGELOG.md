# Changelog

## Unreleased

- Migrate tool contexts to `Ctx` and direct resources. Model routes now expose
  the currently selected dependency and preserve per-run switching through
  request-option wrappers. In-flight requests retain their endpoint, and
  returning to a model reuses its client.

### Fixed

- Report completed WebKit test failures as advisory warnings with successful CI job checks, while retaining required setup and runner failures.

- Keep local editor reports, frontend build output, and development artifacts out of Python source distributions.

### Changed

- Test each CI run against Roboz’s current `main`, resolved once and reported alongside the RoboSprawl revision; build fresh installation and browser candidates from those sources.

- Use Roboz Shed for automatic context compaction, restoring the full continuation prompts and forwarding run cancellation and optional timeouts. Python consumers should import the builder from `roboz_shed.tools` instead of the removed `robosprawl.compaction` module.

- Verify installed backends with the production frontend in Chromium, Firefox, and WebKit. E2E runs retain diagnostics and clean up their services and temporary data after failures or interruption.
