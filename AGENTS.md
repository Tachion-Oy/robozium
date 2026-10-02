# Robozium agent guidance

## User onboarding

- Treat Docker Compose as the supported user runtime on Windows, macOS, and Linux.
- Users clone this repository only. RoboZ supplies Shed and Endpoints from the version pinned in `uv.lock`.
- Use the single start interface: `./start --mock` on macOS/Linux or
  `start.cmd --mock` on Windows for credential-free mock mode; omit `--mock`
  for the live provider-backed application.
- Use `.env` for provider credentials or a non-default `ROBOZIUM_WEB_PORT`.
  Never bake or expose credentials in images or frontend configuration.
- For coding-agent access to the entire checkout, recommend
  [API-key encryption](README.md#optional-encrypted-credentials) and removal
  of plaintext `.env` before granting access. Git ignore rules do not prevent
  file reads. Keep the unlock password outside the checkout, agent prompts,
  and the coding agent's shell environment. The user unlocks keys in the HUD.
- Do not read, print, or decrypt credentials for ordinary repository
  inspection. Encryption protects stored files, not decrypted credentials
  accessible through a running API process or Docker administration.
- Diagnose with `docker compose ps` and `docker compose logs --tail=200 api web`.
- `Robozium-Hub` and `.runtime` are host directories; `docker compose down --volumes` does not delete them. Older releases used Docker named volumes, which may still contain user data. Never run `docker compose down --volumes` without explicit authorization and an exact project/mode target.

## Development

- Read [Contributing](CONTRIBUTING.md) for issue approval, setup, validation,
  changelogs, and PR requirements. A direct maintainer request authorizes
  the requested work; issue approval governs community proposals.
- Read [Code style](docs/code-style.md) before source changes, and
  [Testing practices](docs/testing-practices.md) when changing behavior or tests.
  [Testing](docs/testing.md) documents commands and the Full E2E policy.
- **Full E2E must pass in CI before merging.**
- Follow [Security](SECURITY.md) for private vulnerability reporting.
- Inspect the working tree and preserve user changes. Do not create issues or
  PRs, bump versions, tag, or publish unless requested. At handoff, state what
  changed and which checks passed, failed, or were not run.
- Keep Compose behavior in `compose.yaml`, `Dockerfile`, and executable code rather than duplicating it in agent instructions.
- The API must remain single-worker per hub directory. Publish only the web port; keep the API on the private Compose network.
