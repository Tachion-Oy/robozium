# Changelog

## Unreleased

### Fixed

- Keep local editor reports, frontend build output, and development artifacts out of Python source distributions.

### Changed

- Verify installed backends with the production frontend in Chromium, Firefox, and WebKit. E2E runs retain diagnostics and clean up their services and temporary data after failures or interruption.
