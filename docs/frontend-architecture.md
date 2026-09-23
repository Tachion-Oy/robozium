# Frontend architecture

The component folders follow the visible composition: the page contains a terminal and a HUD; the HUD contains three selectable screens. This makes ownership easy to find without introducing a separate “shell” abstraction.

```text
web/app/components/
├── AppView.tsx
├── terminal/           Log rendering and its decorative demo
└── hud/                Frame, screen selection, and shared controls
    ├── projects/       Project overview and create/open/cancel/delete actions
    ├── dependencies/   Dependency status and checks
    └── run/            Agent messages, history, replies, copy, and dictation
```

## Responsibilities

`app/page.tsx` fetches initial data. `AppView` provides the run session, composes the terminal and HUD, manages the landing intro, and redirects home when a run ends or becomes unavailable.

`AgentHUD` owns the HUD frame: visibility, size, panel layout, and the reply draft that survives screen changes. `hudPresentation` resolves available screens, selection, model scope, and header/control presentation for landing, active-run, and recovery contexts. `HudScreenContent` renders the selected screen. Keep these decisions out of individual screens.

`RunHud` selects the displayed agent message once and passes it through the form to the copy controls. The display and clipboard therefore use the same message, including history and streaming output. Frame controls live in `HudCornerControls`; run actions live in `run/HudControls`.

The terminal and HUD consume the same session. Transport, polling, and state reduction belong in `lib/robozium/session`; hooks connect that state to React. Navigation, feedback, and theme components retain their own folders.

## Placement rules

- Keep screen-specific components and private helpers with their screen. Put controls shared by the HUD frame or multiple screens directly under `hud`.
- Use relative imports within the HUD. Keep cohesive helpers together; avoid wrappers that only forward exports.
- HUD frame, panel, and control CSS lives at the HUD root because it spans screens. Project-overview CSS lives with projects. Keep base and light-theme rules together, theme tokens global, and the import order in `globals.css` stable.
- Mirror component ownership in `tests/app/components`. Use existing browser checks and visual baselines to verify structural changes.

Known runtime follow-ups are recorded separately in the [frontend runtime review](frontend-runtime-review.md).
