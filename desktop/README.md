# Robozium

The Electron app is under development. It currently shows the application name
and version beneath a four-control HUD header. Model and view selectors use
local preview choices; selecting a view shows its placeholder panel. Light/Dark
switches the theme, and Secrets unavailable is disabled. This preview needs no
Docker services or provider credentials.

## Run on Linux

Requires Node.js 22.12 or newer and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Close and restart the app to rebuild after changes. Local app data is stored in
`.artifacts/desktop/scaffold/`.

The app starts in dark mode with Mock model and Runs Overview selected. Tab moves
through the model selector, theme button, and view selector, skipping Secrets.
Open a selector with a click, Enter, Space, or an arrow key. Use arrows, Home/End,
or type a name prefix to explore choices. Enter, Space, or Tab accepts the
highlighted choice; Escape or clicking the open trigger cancels. Clicking outside
accepts the highlighted choice and dismisses the popup. Only one popup opens at
a time. Model/view choices survive theme changes and reset when the page reloads
or the app restarts.

Runs Overview, Dependencies, and Environment currently display “This view is
coming soon.” Resize the window to try the compact header. Truncated labels retain
their full hover tooltips.

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
- `renderer/src/components/views/` contains the view placeholder and its CSS.
- `renderer/src/fixtures/` contains local model and view choices.
- `renderer/src/styles/app.css` contains app-wide typography, theme tokens,
  base styles, and the frame.
- `renderer/tsconfig.json` supplies the renderer's browser and Vite asset types
  to both the editor and the command-line type check.
- `tests/` contains native scenarios and screenshot baselines.

Keep new components with their feature and their styles beside them. Add folders
as those features arrive in the desktop roadmap.
