# Robozium agent guidance

## User onboarding

- Treat Docker Compose as the supported user runtime on Windows, macOS, and Linux.
- Users clone this repository only. RoboZ supplies Shed and Endpoints from the version pinned in `uv.lock`.
- Use the single start interface: `./start --mock` on macOS/Linux or
  `start.cmd --mock` on Windows for credential-free mock mode; omit `--mock`
  for the live provider-backed application.
- Use `.env` for provider credentials or a non-default `ROBOZIUM_WEB_PORT`.
  Never bake or expose credentials in images or frontend configuration.
- Diagnose with `docker compose ps` and `docker compose logs --tail=200 api web`.
- `Robozium-Hub` and `.runtime` are host directories; `docker compose down --volumes` does not delete them. Older releases used Docker named volumes, which may still contain user data. Never run `docker compose down --volumes` without explicit authorization and an exact project/mode target.

## Development

- Keep Compose behavior in `compose.yaml`, `Dockerfile`, and executable code rather than duplicating it in agent instructions.
- The API must remain single-worker per hub directory. Publish only the web port; keep the API on the private Compose network.
