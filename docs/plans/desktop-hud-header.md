# PR 3b.1 — Shared button component and HUD header layout

## Result

Add a desktop-local shared button and complete header row after the
[frame and themes](desktop-hud-frame.md) in PR #81 (`602e904`). Model, secrets,
and view controls display disabled fixtures; theme switching remains functional.
This is the next increment of the [desktop roadmap](desktop-roadmap.md).

## Implementation

- Start a separate worktree from freshly pulled `main` after PR #81 is merged.
  Preserve the experiment and existing user changes.
- Adapt the experiment's `HudButton` with native button props and ref support.
  Default to `type="button"`; support `info`, `success`, `warning`, and `danger`.
  Preserve native attributes, event handlers, disabled behavior, and caller classes.
- Move common geometry, surfaces, and interaction states out of the theme-toggle
  stylesheet into shared button styling. Preserve the theme button's appearance;
  keep the indicator and selector caret styling with their respective controls.
- Add `HudHeader`, receiving the current theme and toggle callback. Render green
  **Mock model**, blue **Light/Dark**, red **Secrets unavailable**, and amber
  **Runs Overview**, in that order. Use `HudButton` for all four controls and
  native `disabled` for the three fixtures. Hide decorative carets from assistive
  technology; introduce menu ARIA attributes when working menus arrive.
- Adapt the effective header rules from experiment commit `076b2c9`: one row,
  theme-specific styling, existing frame insets, and 75% density. Let controls
  shrink, cap the model control at 40% of the row, and ellipsize labels while
  retaining their complete accessible names and tooltips.
- Keep theme state in `App`, starting dark. Preserve the name/version content
  and loading/error behavior. Keep components, styles, and fixtures under
  `desktop/`; the main/preload interface remains `getVersion()`.
- Target 200–400 changed production lines, below roughly 500. Carry over only
  styles used by this header; keep browser code and dependencies independent.

## Validation and handoff

- Retain existing native scenarios. Extend keyboard and theme checks to verify
  that disabled controls are skipped and theme switching retains focus.
- Review and update all eight screenshots: dark/light themes at 1260×780 and
  640×420, with native zoom 1 and 1.25. Check full-window coverage, contained
  controls, readable or correctly truncated labels, complete accessible names,
  and absence of document overflow.
- Run desktop lint, types, build, and native tests. Verify a fresh desktop-only
  installation/build and run `git diff --check`.
- Include this plan, roadmap split, concise changelog entry, and practical
  desktop README update in the PR. Record the experiment source commit and
  adapted files in its description.
- Monitor every CI check on the latest commit, including browser regressions,
  Electron, and Full E2E. All must pass before handoff.

## Following increments

PR **3b.2** adds interactive model/view selectors using local fixture state.
Credential operations remain in the credential-unlocking step. Content panels
and footer controls follow in their existing roadmap steps.
