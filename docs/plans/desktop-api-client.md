# PR 6 — Connect the desktop directly to the Python API

This records the PR 6 transport design. PR 8 moves run endpoint construction
into the run feature and exposes generic SSE paths from the shared client; see
the current [code layout](../../desktop/README.md#code-layout).

## Summary

Deliver HTTP, SSE, and connection/error/retry presentation in one PR. React makes
application API requests; main supplies the selected loopback address and manages
Docker. The existing Python backend remains authoritative for behavior and storage.
Project/model selectors and run controls retain their fixtures until later increments.

Start from main containing merged PR #90 (`2a07202`) in
`/tmp/robozium-desktop-api`, branch `feat/desktop-api-client`.

## Implementation

- Add `getBackendConnection(): Promise<{ baseUrl: string } | null>` to the
  typed bridge, with trusted window, main-frame, and document checks. Preview
  returns null. Use the same controller address in the bundled-page response's
  CSP `connect-src`; enable the custom scheme's fetch and CORS privileges while
  preserving sandboxing, context isolation, and navigation restrictions.
- When `ROBOZIUM_DESKTOP_API_PORT` is present, reject incorrect Hosts and origins
  before endpoint dispatch. Accept exactly `robozium://app` and the selected
  `127.0.0.1:port` Host. Preserve originless native health checks/CLI requests;
  reject originless requests carrying Fetch Metadata. Configure explicit CORS
  methods and headers. Integrate the desktop origin into Environment validation
  without bypassing request limits, credentials, or storage checks. Browser mode
  keeps its existing behavior. Add no authentication system or endpoints.
- Add a desktop-local TypeScript client using native fetch, JSON requests, and
  `streamRunEvents(runId, signal)`. Resolve paths against the selected address,
  reject origin changes/redirects, omit cookies, and disable caching. Distinguish
  HTTP status/safe detail, malformed responses, connection errors, and cancellation.
- Adapt only SSE framing from `web/lib/robozium/sse.ts` at
  `8343b8e388fb5c6112e651ac46f081333080939c`. Support fragmented UTF-8, CR/LF/CRLF,
  comments, and multiline data. Yield JSON as unknown; leave run schema validation
  and automatic reconnection to session integration. Cancel and release readers
  on abort or early exit, and propagate stream errors. Add no dependencies.
- After Docker startup, check `/ready` through the renderer's actual client before
  mounting the HUD. Check again five seconds after each successful check, with a
  three-second timeout and no overlap. On failure stop polling and show an
  accessible Retry notice, preserving the mounted HUD's draft, selections,
  divider, and theme. Retry cancels obsolete requests and resumes polling after
  success without restarting/rebuilding Docker. Clean up on unmount. Preview
  stays fully local.
- Keep the folder boundary: desktop prepares mount sources and its bookkeeping;
  the hub controls application storage inside those mounts.

## Verification and delivery

Cover accepted/rejected Host/Origin, preflight, native/browser requests,
Environment limits/storage, and credential gates. Test HTTP errors, malformed
responses, cancellation, SSE byte boundaries, early disposal, and reader cleanup.
Use disposable native mock backend resources and the actual desktop client to
seed/stream a run without production demonstration controls. Verify initial
connection failure, outage, Retry recovery, retained HUD state, and outage notice
geometry/screenshots in both themes at normal/narrow sizes and 125% zoom.

Run desktop lint/types/build, backend staging/lifecycle/Docker suites, native UI
and backend suites, Python checks, a desktop-only installation/build, and
`git diff --check`. Preserve browser regression coverage. Update the roadmap,
desktop README, testing guide, and changelog. Record copied sources, adaptations,
production-line count, and validation in one readable PR. Commit, push, open the
PR, and stop without waiting for CI or merging, as requested. Required checks,
including Full E2E, must pass before merge.
