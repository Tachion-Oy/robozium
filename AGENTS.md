# Robozium agent guidance

## User onboarding

- The Electron app in `desktop/` is the only Robozium app. It runs the Python
  API in Docker; Debian and Ubuntu users install it with apt (see the
  [README](README.md)). RoboZ supplies Shed and Endpoints from the version
  pinned in `uv.lock`.
- From a checkout, run `npm --prefix desktop start -- --mock` for
  credential-free mock mode; omit `--mock` for the live provider-backed app.
- Provider credentials are saved through the HUD's Environment panel. Never bake
  or expose credentials in images or renderer code.
- For coding-agent access to the entire checkout, recommend
  [API-key encryption](README.md#optional-encrypted-credentials) and removal
  of plaintext `.env` before granting access. Git ignore rules do not prevent
  file reads. Keep the unlock password outside the checkout, agent prompts,
  and the coding agent's shell environment. The user unlocks keys in the HUD.
- Do not read, print, or decrypt credentials for ordinary repository
  inspection. Encryption protects stored files, not decrypted credentials
  accessible through a running API process or Docker administration.
- Diagnose with the commands in the
  [desktop README](desktop/README.md#manual-desktop-backend-linux).
- The hub folder (`~/Robozium-Hub` by default) holds user projects. Never delete
  or move it without explicit authorization.

## Development

- Read [Contributing](CONTRIBUTING.md) for issue approval, setup, validation,
  changelogs, and PR requirements. A direct maintainer request authorizes
  the requested work; issue approval governs community proposals.
- Read [Code style](docs/code-style.md) before source changes, and
  [Testing practices](docs/testing-practices.md) when changing behavior or tests.
  [Testing](docs/testing.md) documents commands and the Full E2E policy.
- **Full E2E must pass in CI before merging.**
- **Do not hand off a PR with failed or pending CI.** Run the applicable local
  checks before opening or updating a PR, then use `gh` to monitor every required
  check, including Full E2E, on the latest commit. Investigate and fix failures,
  push the corrections, and keep working until all required checks pass. Do not
  treat local success, a successful push, or opening the PR as completion. Never
  weaken or skip checks to obtain a pass. If an external blocker prevents
  completion, report the blocker explicitly and leave the task incomplete.
- Follow [Security](SECURITY.md) for private vulnerability reporting.
- Inspect the working tree and preserve user changes. Do not create issues or
  PRs, bump versions, tag, or publish unless requested. At handoff, state what
  changed and which checks passed, failed, or were not run.
- Keep backend runtime behavior in `desktop/compose.yaml`, `desktop/Dockerfile`, and executable code rather than duplicating it in agent instructions.
- The API must remain single-worker per hub directory. Keep the API listener restricted to host loopback.
