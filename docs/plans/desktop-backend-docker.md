# PR 4 — Desktop-owned backend Docker configuration

## Summary

Add an independently buildable Docker backend under `desktop/`, supporting manual live and mock startup. Live remains the default; mock provides credential-free validation.

This increment supplies the backend configuration and documented commands. Electron manages Docker in PR 5 and connects to the API in PR 6.

## Implementation

- Add `desktop/Dockerfile` containing the existing Python dependency and API stages, preserving locked dependencies, Linux CLI tools, non-root execution, and health checks. Exclude the Next.js and browser-test stages.
- Add `desktop/compose.yaml` with one `api` service. Use host networking, bind Uvicorn to `127.0.0.1`, and enforce one worker. Retain graceful shutdown and `/ready` health checks.
- Add a dependency-free staging script exposed as `npm --prefix desktop run backend:stage`. Stage into ignored `desktop/.stage/backend`, copying only the desktop Docker recipe/configuration, backend Python sources, lockfile, package metadata, and required licensing/readme files. Reject symlinks and exclude credentials, private imports, hubs, caches, and frontend files.
- Adapt the experiment’s backend Compose configuration and staging approach from `076b2c9`. Keep the desktop configuration local; leave the browser Docker configuration and launchers unchanged.

### Runtime contract

- Use separate runtime directories under `.artifacts/desktop/data/live` and `.artifacts/desktop/data/mock`, with API ports **18001** and **18000** respectively.
- Support explicit mode, runtime-directory, port, and API-user overrides through Compose variables. Document rootful UID/GID mapping and the rootless Docker override.
- Mount the selected runtime’s configuration, hub, logs, local packages, dependency cache, and host-script directory. Preserve read-only mounts for the host socket and safe scripts; require bind-mount sources to exist.
- Load optional runtime `.env.encrypt`, then `.env`, retaining existing precedence. Keep credentials out of build inputs and frontend configuration. Use an explicit empty Compose interpolation file so checkout credentials are not automatically loaded.
- Document staging, directory preparation, build/start, readiness, diagnostics, and shutdown for both modes. Use explicit mode-specific project names and preserve runtime data during shutdown.
- Add no renderer changes, IPC methods, automatic Docker lifecycle, host-helper process management, or backend API changes.

## Validation

- Add separate desktop backend tests for staging contents, exclusion of synthetic private files, symlink rejection, and operation without a `web/` checkout.
- Resolve Compose for both modes using synthetic credentials. Assert service isolation, environment precedence, mount paths/permissions, loopback binding, configurable ports, health checks, and one worker.
- Build and start the real mock container with a disposable runtime and unique project name. Check readiness, create a project through the existing API, restart the container, and verify persistence.
- Verify credentials are absent from the image and that shutdown preserves host data. Collect failure diagnostics and clean up only the exact test project, without `--volumes`.
- Add these checks to the existing Docker Full E2E job, preserving all current required jobs and browser checks.
- Run desktop lint/types/build, the complete native suite, backend tests, the real Docker smoke test, affected workflow tests, and `git diff --check`. Live credential wiring uses synthetic configuration tests; no provider requests are required.

## Documentation and delivery

- Save the plan as `docs/plans/desktop-backend-docker.md`; update the roadmap, desktop README, testing guide, and changelog.
- Start from updated main after PR #86 merges, in `/tmp/robozium-desktop-backend` on `feat/desktop-backend-docker`.
- Target 200–400 changed production lines and keep this PR focused on configuration and manual operation.
- Commit, push, and open one PR recording source adaptations and validation. Create no issues. Stop after opening the PR and ask for further instructions; do not wait for CI or merge. Required CI must still pass before merging.
