# Changelog

## Unreleased

### Fixed

- Keep local editor reports, frontend build output, and development artifacts out of Python source distributions.

### Changed

- Use Roboz Shed for automatic context compaction, restoring the full continuation prompts and forwarding run cancellation and optional timeouts. Python consumers should import the builder from `roboz_shed.tools` instead of the removed `robosprawl.compaction` module.

- Verify installed backends with the production frontend in Chromium, Firefox, and WebKit. E2E runs retain diagnostics and clean up their services and temporary data after failures or interruption.
