# Contributing

Use the Docker onboarding path in [README](README.md); it is the only supported
local setup and requires no sibling dependency checkout. Contributors may use
whatever additional host tooling they prefer. Validation runs in CI without
service credentials; its contracts are documented in
[testing](docs/testing.md).
Keep application API, persisted data, prompts, and validation compatible. Add
focused contract or E2E coverage for changed behavior and record externally
observable changes in [Unreleased](CHANGELOG.md).

Require **CI** before merging: unit tests, lint, and type checks. **Full E2E**
runs all three browsers and Docker checks after merges to main, or manually on
a selected branch. Completed WebKit test failures remain advisory. Review visual
baselines intentionally; CI does not update them. Report local results separately
from actual GitHub Actions runs.
Do not publish, tag, or bump versions as part of ordinary development.
