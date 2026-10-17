# PR 7 — Connect project and model selection

## Result and scope

Build on merged #92 (`2d6c01a6b997c64bf5362bb0c2cd951ef5401cd1`) using
`feat/desktop-project-model-selection` in `/tmp/robozium-desktop-selection`.
The checkout was already clean on that merge when implementation began; resetting
it to updated `origin/main` left no premature changes to retain.

React receives the existing client from startup. Runs Overview lists real projects,
creates projects, and keeps an explicitly selected slug in mounted application
state. The header loads `/models` and changes the backend default through
`POST /models` without a run ID. Python remains authoritative for data.

Preview remains local. Connected mode retains the mock history under **Preview
run**. Live run creation, streaming presentation, replies, credentials, deletion,
and capability selection remain later increments. No dependencies, endpoints,
Python changes, or browser changes are included.

## Implementation

- `api/selection.ts` supplies named request helpers and validates the minimum
  response fields used by controls. Reject malformed/duplicate identifiers,
  malformed labels, unknown selected models, and mismatched write acknowledgement.
- `api/useSelection.ts` owns project rows/selection/name and confirmed models.
  Each operation has a synchronous in-flight guard, a ten-second deadline, and
  cancellation on unmount. Refresh/navigation cancels obsolete project reads.
  Model reads and writes share a guard. Writes never retry automatically.
- Project rows use keyboard-operable pressed buttons. The labelled form submits
  on Enter. Creation selects the returned slug, clears the name only on success,
  and starts a separate refresh. Refresh failure preserves rows and selection
  and cannot resubmit the creation. View changes/outages preserve local state;
  reload resets it while backend projects persist.
- The existing model dropdown displays only acknowledged choices, handles empty
  catalogues, and retains its keyboard behavior. Failed writes keep the confirmed
  choice and offer explicit Retry. Refresh models reloads the catalogue after a
  successful request. Request controls retain their DOM identity and focus;
  pending writes use guarded `aria-disabled` controls and a read-only name input.
- Connected content scrolls within the frame. Project names wrap, while long
  model labels retain the existing ellipsis and full accessible name/tooltip.
  Compact connected status controls and panel padding preserve readable preview
  content during an outage in short windows.

## Copied sources and adaptations

Both source files were read at `2d6c01a6b997c64bf5362bb0c2cd951ef5401cd1`:

- `web/lib/robozium/client.ts`: adapt `listProjects`, `createProject`,
  `getModelSelection`, and `selectModel` to the PR 6 client and direct paths.
  Remove Next.js `/api` routing and run-scoped model arguments. Keep signal
  propagation and add runtime validation instead of trusting type assertions.
- `web/lib/robozium/wire.ts`: adapt the project creation/list slug and
  `AvailableModel`/`ModelSelection` fields. Omit project run metadata and unrelated
  contracts; validation needs no schema dependency.

The hooks and project presentation are desktop-local additions. Existing desktop
header, selector, startup, and preview components are adapted in place.
Production diff: **265 changed lines** (240 additions, 25 removals), including CSS
and adapted source, below the roadmap's 200–400-line target. Tests and documents
are counted separately; there are no lockfile or binary asset changes.

## Verification and delivery

The native selection scenarios use controlled real HTTP responses to test delayed
acknowledgement, rejected/malformed writes, empty/malformed catalogues, read/write
deadlines, cancellation, duplicate-submit guards, separate refresh failure,
keyboard focus, retained names/choices, and reload reset. Long-name captures cover
both themes at 1260×780 and 640×420, including 125% zoom. Existing preview visual
baselines remain unchanged.

The disposable Docker native suite creates projects through the form, checks
actual duplicate-name errors, keyboard selection, Refresh, outage preservation,
and persistence after close/reopen. Backend staging, lifecycle unit tests, and
Docker smoke checks protect startup and storage behavior. An independent copy
of desktop installs and builds without browser files/dependencies.

Local validation passed: lint/types/build; 73 native tests with unchanged preview
baselines; 10 final connected selection scenarios after the layout refinement;
13 staging/Compose checks; 34 lifecycle unit tests; Docker restart smoke; and all
10 native backend scenarios, including the corrected narrow-outage regression.
A fresh desktop-only install/build and `git diff --check` passed. Python/browser
regressions remain required in CI/Full E2E.

Commit, push, open one focused PR, and monitor **CI** and **Full E2E** on its latest
commit until all required checks pass. Do not merge.
