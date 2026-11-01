# PR 5 — Manage Docker from Electron main

> **Superseded.** The backend now runs in rootless Podman without Compose; see
> [`podman-engine.ts`](../../desktop/src/podman-engine.ts) and
> [`backend-layout.json`](../../desktop/src/backend-layout.json). The plan below is kept as history.

## Summary

Start the existing API-only backend when the desktop app launches, show startup
status and retry, and stop owned services when its window closes. Keep fixture
HUD behavior until PR 6 connects the desktop HTTP/SSE client.

Build on merged PR #87 in `/tmp/robozium-desktop-lifecycle`, branch
`feat/desktop-backend-lifecycle`. Adapt experiment `076b2c9`'s controller,
process cancellation, and installation identity handling to the typed scaffold.

## Implementation

- Add a focused main-process controller for Docker discovery, Compose/daemon
  checks, image reuse/building, startup, readiness, cancellation, and shutdown.
  Bound child command duration/output; cancel Linux process groups without a shell.
  Resolve and pin the selected Docker target for all commands, retries, and cleanup;
  retain explicit context/host precedence and TLS settings.
- Hash allowlisted staged inputs and label built images with their identifier.
  Rebuild on missing/changed images and reuse matching images on later launches.
- Preserve `.artifacts/desktop/data/{live,mock}` and the experiment's saved
  installation ID/API ports without rewriting settings. Persist a stable ID for
  new profiles. Default to live; provide explicit `--mock` validation.
- Scope Compose to the installation and mode. Verify project/service/installation/
  port labels and all runtime bind mounts before changing or stopping containers.
  Reject foreign containers and occupied ports. Keep provider credentials in the
  runtime files/backend and clear inherited Compose/Robozium overrides.
- Closing cancels and awaits startup, then rechecks ownership and stops exact
  container IDs with a separate deadline. Preserve containers, images, and data.
  Acquire a basic single-instance lock now to prevent competing controllers;
  duplicate-launch focus behavior and persisted preferences remain PR 17.
- Expose only named startup-status and retry IPC with trusted window, main-frame,
  and document checks. Add a minimal accessible startup/error view and Retry.
  The full introduction remains PR 14; application API traffic remains PR 6.
- Make `npm start` stage/build and launch the managed backend. Keep
  `start:preview` and the native UI suite independent of Docker/shared Python.
  Add no dependencies, browser changes, host helper, or credential-unlock UI.

## Validation

- Exercise missing Docker, incompatible Compose, daemon failure, occupied ports,
  image reuse/rebuild, ownership mismatch, readiness failure/retry, and cancellation
  during build/start/readiness using scripted external boundaries and real files.
- Execute child-process timeout/cancellation tests and preserve bounded output,
  argument isolation, and safe errors. Recheck ownership at shutdown and retain data.
- Launch sandboxed Electron against a real isolated mock Docker backend. Verify
  error/retry, first build, readiness, native close, image reuse, and persisted
  projects on reopen. Close during a blocked build and verify process cleanup.
- Reject untrusted lifecycle IPC callers and retain the full native UI suite,
  screenshot baselines, backend configuration/staging tests, and Docker smoke.
- Add lifecycle checks to CI and the existing Docker Full E2E job without dropping
  existing jobs. Verify desktop-only installation/build, lint/types/build,
  workflow checks, and `git diff --check`.

## Delivery

Update the roadmap, desktop README, testing guide, and changelog. Record source
adaptations, changed production-line count, and local validation in one PR.
Commit, push, open the PR, and stop without waiting for CI or merging, as requested.
Required CI must still pass before merge. The next increment remains PR 6.

## Module responsibilities

`backend-controller.ts` coordinates lifecycle decisions. `docker-command.ts`
executes one CLI command and handles its output, timeout, and cancellation.
`loadOrCreateBackendProfile()` names the profile loader's identity persistence
explicitly. `backend-layout.json` supplies the runtime mounts and paths to both
Compose and the shared runtime preparation helper; controllers contain no
separate directory or mount lists. Desktop setup prepares bind-mount sources and
its own bookkeeping files. The hub controls the application structure and files
inside the mounts; desktop setup does not pre-create local capability folders.
