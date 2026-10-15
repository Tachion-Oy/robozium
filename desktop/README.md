# Robozium

The Electron app is under development. It currently shows the application name
and version beneath a four-control HUD header. Start run in Runs Overview opens
a local mock message and editable reply panels. Model choices remain local;
Light/Dark switches the theme, and Secrets unavailable is disabled. This preview
needs no Docker services or provider credentials.

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

Select **Start run** in Runs Overview to open **Current Run**. The mock message
appears above an empty reply editor. Draft freely: Enter and Shift+Enter insert
newlines; replies are not sent yet. The arrow buttons in the left rail move the
divider between message-expanded, equal, and reply-expanded positions. At each
limit, the unavailable direction is disabled. Messages and long drafts scroll
inside their own panels.

Switch views using the header, or use **Return to run** in Runs Overview. The
draft and divider position survive view, model, theme, window-size, and zoom
changes. Reloading or restarting resets the preview to Runs Overview with no
active run. Dependencies and Environment still display “This view is coming
soon.” Divider controls remain visible but disabled outside Current Run.

Resize the window to try the compact header. Truncated labels retain their full
hover tooltips. API connections, provider credentials, and environment editing
arrive in their later roadmap steps.

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
- `renderer/src/components/hud/` contains the header, panels, divider controls, and their CSS.
  Components import the styles they own; the header currently owns its inline
  theme toggle's styling.
- `renderer/src/components/views/` contains Runs Overview, view placeholders, and their CSS.
- `renderer/src/fixtures/` contains local model/view choices and the mock run message.
- `renderer/src/styles/app.css` contains app-wide typography, theme tokens,
  base styles, and the frame.
- `renderer/tsconfig.json` supplies the renderer's browser and Vite asset types
  to both the editor and the command-line type check.
- `tests/` contains native scenarios and screenshot baselines.

Keep new components with their feature and their styles beside them. Add folders
as those features arrive in the desktop roadmap.
