# PR 3a — Port the Robozium frame and themes

## Result

The Electron application displays its existing name and version inside the
experiment's full-window surface, with a button for dark and light themes.
This is the first increment of the [HUD port](desktop-roadmap.md): header,
content panels, and footer follow in separate small PRs.

## Implementation

- Start a separate worktree from freshly pulled `main`; verify merged PR #80
  (`ad2e166`) is present. Preserve the experiment and existing worktrees.
- Use experiment commit `076b2c9` as the visual reference. Port the effective
  opaque dark grid and light inset surface, theme-specific spacing, and colours.
  Copy only rules needed by the mounted screen and resolve desktop overrides
  into direct CSS. Keep the production diff around 200–400 lines.
- Keep one full-window frame around the name/version content and theme button.
  Use React and CSS within `desktop/`, with independent dependencies.
- Bundle Source Code Pro Latin 400 from pinned package version 5.3.0. Load it
  through the existing local protocol, adding only `font-src 'self'` to the CSP.
- Start dark; keep theme state in React and apply `data-theme` to the document.
  The button displays the available action, Light or Dark. Theme persistence
  belongs to the later preferences PR.
- Preserve the experiment's 75% root density and theme-specific insets. Fill
  the client area; keep text and the theme control usable at narrow sizes and
  native zoom. Retain version loading and failure states.
- Keep the existing preload contract. Backend access, shared packages, routing,
  Tailwind, startup animation, and simulated application operations are later work.

## Validation and handoff

- Retain all 15 native scenarios; replace the scaffold's cosmetic assertions
  with bundled-font and frame checks.
- Test mouse and keyboard theme switching, visible focus, and retained focus.
- Check both themes at 1260×780 and 640×420 client sizes, at native zoom 1 and
  1.25. Assert full-window coverage, contained text, and usable controls.
- Capture settled Linux screenshots after fonts load. Review the frame against
  the experiment, then commit baselines with automatic updates disabled.
- Run desktop lint, type checks, build, and native tests, including installation
  and testing from a desktop-only copy. Review the lockfile and documentation.
- Include the plan, roadmap update, and concise changelog entry in the
  implementation PR. Keep the README focused on running and checking the app.
- Record the source commit and copied/adapted files in the PR description.
  Monitor every required check, including Full E2E, until green before handoff.
