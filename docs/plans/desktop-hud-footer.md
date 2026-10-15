# PR 3d — Desktop footer controls and local helpers

## Summary

Port the experiment's footer into Current Run, with working fixture-message
navigation, Copy, and Clear. Show Send, Cancel, Interrupt, and Record as natively
disabled controls. Deliver one PR, targeting 200–400 changed production lines
but allowing this increment to exceed roughly 500 for a faithful, readable port.

Start from updated main after PR #85 is merged, in
`/tmp/robozium-desktop-footer` on `feat/desktop-hud-footer`.

## Implementation

- Adapt experiment commit `076b2c9`: footer controls, history arrows, copy icons,
  status mark, effective theme styles, and `useDesktopActionLayout`. Render
  Cancel/Interrupt on the left, history navigation around the centered “A” mark,
  and Clear/Copy reply/Copy agent output/Record/Send on the right. Show the footer
  only in Current Run.
- Preserve the measured layout: navigation stays at the geometric center;
  Cancel and Send remain at their outside edges longest; crowded actions wrap
  below in their existing order. Keep control DOM nodes mounted during resizing.
  Colocated CSS owns presentation; the hook supplies measured offsets and
  dimensions through CSS variables.
- Reuse `HudButton` for surfaced actions and retain bare history-arrow buttons.
  Port icon dimensions, padding resets, disabled states, and both themes
  explicitly. Copy the existing Anurati font locally for the status mark.
  Preserve panel surfaces, header sizing, 75% density, frame insets, and the
  existing 220ms divider animation. Footer space flows beneath the panels.
- Replace the single-message fixture with three stable messages. Keep the
  current message latest and initially selected. First/previous/next/latest
  navigation does not wrap. App retains selection with the draft and divider
  across view/model/theme changes. Reload resets the preview. Display a static
  awaiting-input status mark.
- Disable unavailable history directions natively. When navigation disables its
  focused button, focus the nearest enabled reverse-direction button. Clear
  empties the draft and focuses the existing textarea through a shared ref.
  Disable Clear and Copy reply only for an empty draft; whitespace remains valid.
- Extend `DesktopBridge` with `writeClipboardText(text: string): Promise<void>`.
  A named IPC handler validates the trusted window, main frame, document URL,
  and string payload before calling Electron's clipboard API. Retain browser
  permission denial and expose no clipboard-read operation.
- Copy displayed agent text or the exact draft, including whitespace/newlines.
  Show the checkmark and green success feedback for two seconds with an
  accessible announcement. Invalidate stale feedback when content changes.
  Report failure in a compact footer alert and allow retry without changing the
  draft or selection. Clean up timers on unmount.

Keep components, styles, fixtures, and assets under `desktop/`. Add no backend
requests, microphone access, dependencies, simulated sending, or persistence.

## Validation

- Verify all four history actions, boundary disabling/focus transfer, initial
  latest selection, and selection/draft retention.
- On the isolated native test display, verify Clear/focus, exact clipboard
  contents for both targets, empty-draft disabling, success feedback, content
  changes, failure, and retry.
- Cover clipboard rejection for untrusted windows/documents and invalid
  payloads. Retain version, protocol, isolation, zoom, and lifecycle checks.
- Check both themes at 1260×780 and 640×420 with native zoom 1 and 1.25. Assert
  centered navigation, contained controls, centered icons, readable labels,
  usable panels in all three divider positions, and no document overflow.
- Resize across wrapping boundaries with a helper focused and copy feedback
  visible. Verify focus, DOM identity, and feedback survive.
- Review/update the 16 native screenshots; add footer captures in both themes
  with populated drafts and enabled local helpers.
- Run desktop lint, types, build, the complete native suite, a fresh desktop-only
  installation/build, and `git diff --check`.

## Documentation and delivery

Update the roadmap, desktop README, testing guide, and changelog with the local
helpers and clipboard responsibility. Commit, push, and open one implementation
PR. Record source commit `076b2c9`, adapted components/styles, production-line
count, and local validation. Per the maintainer's delivery instruction for this
increment, stop when the PR opens; do not wait for CI or merge. Required CI,
including Full E2E, must still pass before merging.

The next increment remains PR 4: desktop-owned Docker configuration for the
existing backend.
