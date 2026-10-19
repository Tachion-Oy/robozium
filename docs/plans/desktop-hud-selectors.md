# PR 3b.2 — Interactive header selectors and view placeholders

> **Superseded:** see [desktop-roadmap.md](desktop-roadmap.md) (reference CSS transplant).

## Summary

Enable model and view selection using desktop-local fixture state. Selecting a
view displays a simple placeholder panel. Theme switching remains functional;
Secrets stays disabled. Follow the [desktop roadmap](desktop-roadmap.md).

Start from fresh `main` in `/tmp/robozium-desktop-selectors` on
`feat/desktop-hud-selectors`. Announce the worktree path when creating it and
preserve the user's async/await change (`5bee9c3`, merged through PR #83).

## Implementation

- Add one shared selector beside its CSS in the HUD component folder, using
  `HudButton` for the trigger. Adapt only the needed dropdown presentation from
  the experiment's `SelectorDropdown` and `model-selector.css` at `076b2c9`.
- Keep typed selected model/view values in `App`, with callbacks through
  `HudHeader`; the header coordinates one open popup. Choices survive theme
  changes and reset on reload. The main/preload interface stays `getVersion()`.
- Use model fixtures Mock model, Mock fast model, and Mock extended context
  model, defaulting to Mock model. Use view fixtures Runs Overview (`projects`),
  Dependencies (`dependencies`), and Environment (`environment`), defaulting to
  Runs Overview.
- Add a view-placeholder component with colocated CSS. Its heading is the
  selected view and its message is “This view is coming soon.” Keep the Robozium
  name, version, and version loading/error presentation visible.
- Use the [select-only combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/examples/combobox-select-only/).
  Keep DOM focus on the trigger and expose its active option through ARIA.
  Support pointer, Enter, Space, and arrows to open; arrows, Home/End, and prefix
  search to explore; pointer, Enter, Space, or Tab to select; and Escape or
  another click on the trigger to cancel. Outside dismissal accepts the active
  choice without taking focus from the clicked target. Tab continues normal
  focus navigation.
- Give triggers complete accessible names containing their purpose and selected
  label, plus full-label tooltips. Expose popup relationships and option states;
  hide decorative carets.
- Preserve green model and amber view accents, both theme treatments, the single
  header row, the model's 40% width cap, and 75% density. Anchor model options left
  and view options right. Constrain popups to the viewport, wrap option text, and
  scroll internally when necessary.
- Use no backend requests, persistence, or new dependencies. Keep components,
  styles, fixtures, and tests under desktop. Target 200–400 changed production
  lines and remain below roughly 500.

## Validation

- Extend native tests for pointer/keyboard selection, cancellation, dismissal,
  prefix search, one open popup, focus retention, and complete accessible names.
  Verify model → theme → view Tab order, skipping Secrets.
- Check placeholder changes, state retention across theme/view changes, and
  reset on reload. Retain version/error, native zoom, protocol, security, and
  close/reopen scenarios.
- Review all eight existing screenshots. Check both open popups throughout the
  two-theme, two-size, two-zoom matrix; add four popup screenshots at 640×420 and
  zoom 1.25. Verify contained menus, readable labels, visible keyboard highlights,
  and no document overflow.
- Run desktop lint, types, build, native tests, a fresh desktop-only install/build,
  and `git diff --check`. Every CI check, including browser regressions, Electron,
  and Full E2E, must pass on the latest commit before handoff.

## Documentation and delivery

Update the roadmap, desktop README, testing guide, and changelog. Record the
experiment source and adapted files in the PR description. Commit and open the
implementation PR after local validation; report its URL, worktree path, and
completed CI results. Content panels continue in PR 3c and credentials in PR 10.
