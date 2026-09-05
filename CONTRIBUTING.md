# Contributing

Use the sibling dependency checkout and locked setup in [README](README.md).
Run the [CI-equivalent checks](docs/testing.md); they require no service credentials.
Keep application API, persisted data, prompts, and validation compatible. Add
focused contract or E2E coverage for changed behavior and record externally
observable changes in [Unreleased](CHANGELOG.md).

Require the aggregate **CI** status before merging. Chromium, Firefox, and
WebKit all gate changes. Review visual baselines intentionally; CI does not
update them. Report local results separately from actual GitHub Actions runs.
Do not publish, tag, or bump versions as part of ordinary development.
