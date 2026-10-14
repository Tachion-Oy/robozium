# Robozium

The Electron app is under development. It currently shows the application name
and version beneath a four-control HUD header. Light/Dark switches the theme;
Mock model, Secrets unavailable, and Runs Overview are disabled preview controls.
This preview needs no Docker services or provider credentials.

## Run on Linux

Requires Node.js 22.12 or newer and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Close and restart the app to rebuild after changes. Local app data is stored in
`.artifacts/desktop/scaffold/`.

The app starts in dark mode. Press Tab to focus the theme button, then Space or
Enter to switch themes; the disabled controls are skipped. Resize the window to
try the compact header. Truncated labels retain their full hover tooltips.

Use Ctrl++ or Ctrl+= to zoom in, Ctrl+- to zoom out, and Ctrl+0 to reset.
The keypad + and - keys also work with Ctrl.

## Checks

```sh
npm --prefix desktop run lint
npm --prefix desktop run typecheck
npm --prefix desktop run test:electron
```

On Linux without a display, run the tests with
`xvfb-run -a npm --prefix desktop run test:electron`.

See the [testing guide](../docs/testing.md#electron-scaffold-checks) for diagnostics
and CI details.

## Code layout

- `src/` contains Electron main, preload, and the typed bridge.
- `renderer/src/` contains the React entry point and app state.
- `renderer/src/components/hud/` contains HUD components and their CSS.
  Components import the styles they own; the header currently owns its inline
  theme toggle's styling.
- `renderer/src/styles/app.css` contains app-wide typography, theme tokens,
  base styles, and the frame.
- `tests/` contains native scenarios and screenshot baselines.

Keep new components with their feature and their styles beside them. Add folders
as those features arrive in the desktop roadmap.
