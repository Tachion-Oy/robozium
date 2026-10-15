# PR 3c — HUD message/composer panels and divider controls

## Summary

Port the experiment's content panels into the independent desktop renderer,
using a local mock run and an editable draft. Follow the
[desktop roadmap](desktop-roadmap.md). The maintainer clarified that starting a
run should show the mock now; API keys and environment setup remain later work.
Accordingly, open Runs Overview initially and enter Current Run on Start run,
rather than automatically entering an active fixture at startup.

Build on merged PR #84 from updated main in `/tmp/robozium-desktop-panels`, branch
`feat/desktop-hud-panels`. Announce the worktree path and preserve user changes.

## Implementation

- Runs Overview offers Start run before a mock run exists and Return to run
  afterward. Starting creates only local preview state and focuses the editor.
  Add Current Run before the other view choices once the run exists. Dependencies
  and Environment retain their placeholders. Selecting Current Run through the
  header preserves focus on the selector.
- Keep message, editor, panel container, and divider components in the desktop
  HUD folder with colocated CSS. Keep overview presentation in views and mock
  content in fixtures. Use deterministic multiline plain text; rich rendering
  and streaming arrive with backend run integration.
- Keep draft and layout state in App. Begin with an empty draft and the `top`
  layout. Preserve state across views, models, and themes; reset on reload.
  Preserve the editor node and caret through layout, theme, resize, and zoom.
  Enter and Shift+Enter insert newlines. Sending remains a later increment.
- Retain Robozium and its version/loading/error presentation in a compact row
  above the content. Preserve the user's existing version-fetch implementation.
- Adapt the effective panel/editor/corner-control presentation from experiment
  commit `076b2c9`, including desktop overrides. Preserve 75% density, frame
  insets, stacked panels, dark bevels, light rounded surfaces, and opaque fills.
  Copy only styles used by this increment.
- Use `top` (message expanded), `equal`, and `bottom` (composer expanded).
  Up moves top → equal → bottom; down reverses it without wrapping. Retain the
  compact-height formula and desktop 45% cap. Both panels scroll internally.
- Use blue HudButton arrow controls in the left rail. Disable directions at
  their limits; transfer focus to the remaining enabled control when activation
  disables the focused button. Keep both controls visible and disabled outside
  Current Run. Provide names/tooltips and hide decorative SVGs.
- Keep menus above and outside panel clipping. Retain native zoom, header
  behavior, and the `getVersion()` bridge. Introduce no dependencies, backend
  requests, persistence, footer actions, or docked log. Target 200–400 changed
  production lines and stay below roughly 500.

## Validation

- Native scenarios cover idle/start/return navigation, multiline drafting,
  retained state and caret, reload defaults, and absence of HTTP requests.
- Cover divider pointer/keyboard movement, boundaries, disabled controls, and
  focus. Check independent scrolling and wrapping of long drafts.
- Check all three layouts in both themes at 1260×780 and 640×420 with native
  zoom 1 and 1.25: usable panels, contained controls, opaque fills, and no
  document overflow.
- Review/update eight frame and four popup baselines. Add four panel images for
  equal and composer-expanded layouts in both themes at 640×420 and zoom 1.25.
  Keep normal test runs unable to create/update baselines.
- Retain protocol, isolation, version/error, selector, zoom, and close/reopen
  checks. Run desktop lint, types, build, native tests, a fresh desktop-only
  installation/build, and `git diff --check`.
- Require all CI checks on the latest commit, including browser regressions,
  Electron, and Full E2E, before handing off the PR.

## Delivery

Update the roadmap, desktop README, testing guide, and changelog. Commit the
validated implementation and open its PR. Record the source experiment commit
and adapted files. Report the PR URL, commit, completed checks, and worktree path.
The next increment remains PR 3d: footer controls.
