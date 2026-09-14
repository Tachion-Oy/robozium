# RoboSprawl agent guidance

## User onboarding

- Treat Docker Compose as the supported user runtime on Windows, macOS, and Linux.
- Users clone this repository only. RoboZ, Roboshed, and endpoint dependencies come from the versions pinned in `uv.lock`.
- Use the single start interface: `./start --mock` on macOS/Linux or
  `start.cmd --mock` on Windows for credential-free mock mode; omit `--mock`
  for the live provider-backed application.
- Use `.env` for provider credentials or a non-default `ROBOSPRAWL_WEB_PORT`.
  Never bake or expose credentials in images or frontend configuration.
- Diagnose with `docker compose ps` and `docker compose logs --tail=200 api web`.
- Named hub and log volumes are persistent user state. Never run `docker compose down --volumes` without explicit authorization and an exact project/mode target.

## Development

- Keep Compose behavior in `compose.yaml`, `Dockerfile`, and executable code rather than duplicating it in agent instructions.
- The API must remain single-worker per hub volume. Publish only the web port; keep the API on the private Compose network.
