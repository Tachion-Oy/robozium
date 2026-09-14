# Testing

Docker is the only supported local setup. CI uses Linux, Python 3.13 (the
container's version), Node 22, and the dependencies locked in this repository.
No sibling checkout or service credentials are required.

## Pull requests: CI

[ci.yml](../.github/workflows/ci.yml) runs one required `CI` job with Python
unit/contract tests, frontend unit tests, lint, and type checks. Python coverage
must stay at or above 90%. This job also runs on pushes to `main` and can be
started manually. PRs do not run the full browser suites or build Docker images.

## Merges and manual runs: Full E2E

[e2e.yml](../.github/workflows/e2e.yml) runs on pushes to `main`, including merges.
It installs dependencies and builds the production frontend once, then runs the
complete Chromium, Firefox, and WebKit suites sequentially with a fresh hub and
services for each browser. It also checks:

- Application wheel and source-distribution installs, including the pinned
  dependency wheels and their hashes.
- Browser runner cleanup after startup failures, test failures, and interruption.
- Docker first use, generated-file opening, and project persistence after API
  restart, using the same Compose images as the user launcher.

To run the full suite on a PR branch, select **Actions → Full E2E → Run workflow**
and choose that branch. The workflow must first exist on the default branch.

Both workflows cancel superseded runs on the same ref. Dependency downloads are
cached. There are no repeated WebKit stress runs, Python-version matrices, or
emulated architecture builds. Failure reports are retained for seven days;
successful runs do not upload build archives or test reports.

## Results and diagnostics

Require `CI` before merging. Full E2E runs after merge or by manual request.
Chromium and Firefox failures fail Full E2E. Existing WebKit policy is preserved:
completed test failures produce a warning, while setup, runner, and cleanup
failures still fail the workflow. Each browser runs even if an earlier browser
failed. Retries collect diagnostics; flaky tests still fail.

Browser reports under `.artifacts/e2e/` contain traces, screenshots, service
logs, and cleanup results. Visual baselines are never updated automatically.
The existing runner owns and cleans up its temporary hub and processes; the
workflow removes only its disposable Compose volumes.

Package verification and browser runner scripts remain internal test tools.
`ROBOSPRAWL_E2E_PYTHON` selects the installed candidate interpreter and
`ROBOSPRAWL_E2E_PREBUILT=1` reuses the prepared frontend. Tests use isolated
configuration and hub directories. No test-control route is added to the API.

## Docker Desktop host checks

Linux CI does not certify Docker Desktop on Windows or macOS. On a fresh Windows
11 x64 or Apple Silicon Mac clone, run the README launcher and complete the
first-use journey. Record Docker/Compose versions, OS/architecture, image build,
project creation, generated-file opening, and restart recovery. These checks
require no host Python, Node, or uv.
