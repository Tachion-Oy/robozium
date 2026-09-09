# Contributing

Use the locked TestPyPI installation in [README](README.md); no sibling dependency
checkout is required.
Run the [CI-equivalent checks](docs/testing.md); they require no service credentials.
Keep application API, persisted data, prompts, and validation compatible. Add
focused contract or E2E coverage for changed behavior and record externally
observable changes in [Unreleased](CHANGELOG.md).

Require the aggregate **CI** status before merging. Chromium and Firefox gate
changes. Completed WebKit full-suite and stress test failures are advisory;
its setup and runner failures still gate changes. Review visual baselines intentionally; CI does not
update them. Report local results separately from actual GitHub Actions runs.
Do not publish, tag, or bump versions as part of ordinary development.
