# Testing practices

Use focused tests that prove changed behavior and keep future changes safe.
Setup, commands, and CI policy live in [Testing](testing.md).

## Test the behavior

- Assert public behavior and stable contracts, not private call order or source
  layout unless that is the contract being protected.
- Add a regression test for the bug being fixed. Cover meaningful boundary and
  failure cases without expanding a narrow fix into a speculative matrix.
- Keep setup small, fixture graphs shallow, and each test focused on one scenario.
  Use parametrization when the cases represent distinct behavior.
- Prefer precise assertions over snapshots of large unrelated outputs. Do not
  write tests that merely repeat the implementation.

Documentation-only changes and reversible cosmetic edits normally need review
of their result rather than new behavior tests.

## Dependency injection and mocking

Prefer explicit collaborators: scripted endpoints, temporary paths, fake event
sinks, or an injected deployment. Keep the behavior under test real.

Use monkeypatching only to isolate a true external boundary such as environment
variables, time, process execution, filesystem locations, or a provider. Patch
the narrowest boundary and keep it scoped to the test. Do not replace chains of
application internals just to force a branch; use a clearer injection point or a
test at a better boundary.

Default tests must not require provider credentials or contact live services.
Use `tmp_path` or the disposable E2E hub, never a user's live hub. Retain fixture
and process cleanup even when a test fails or is cancelled.

## Backend and frontend coverage

Backend unit tests cover project paths and permissions, configuration,
deployment, prompts, model routing, credentials, events, persistence, and run
lifecycle. Drive real agent behavior with scripted endpoints and assert outputs,
selected tools, emitted events, or persisted data. Contract tests protect shared
wire, typing, dependency, and CI policy behavior.

Frontend Vitest tests cover state transitions, hooks, parsing, and rendering.
Use controlled transport data for ordering, refresh, and failure cases. Verify
meaningful user-visible outcomes rather than component implementation details.

Use Playwright for browser interactions across the real frontend and mock
backend, and container tests for Docker onboarding and restart recovery. Use
the repository's runner so the hub is isolated and processes are cleaned up.
Keep browser assertions tolerant of normal asynchronous rendering, while
checking the final state and errors explicitly. Avoid fixed sleeps when a
condition can be awaited.

The Python coverage gate is a floor, not a reason to add redundant tests. Explain
which behavior a test protects and why its boundary is appropriate. Apply the
Full E2E failure policy in [Testing](testing.md#full-e2e-policy) when interpreting
browser results.
