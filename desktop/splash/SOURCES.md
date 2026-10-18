# Startup presentation sources

The maintainer authorized copying the splash animation and artwork from the
`experiment/electron` worktree at `076b2c9b95755ba02c67fae8a901d6ddb8812c01`.
Only startup presentation and its dependencies were inspected for this port;
the reference application's run, persistence and backend logic were not copied.

- `desktop/web/startup/StartupScreen.tsx` and `startup.css`: the introduction,
  translucent loading surface, regular octagon and 500 ms handoff.
- `desktop/web/app/components/terminal/demo/DemoLog.tsx`: 160 characters/second,
  an 85 ms row cascade, alternating reveal direction and a 1600 ms final pause.
- `desktop/web/app/components/terminal/placeholders.tsx` and its rendered demo
  markup: the static fictional introduction in `index.html`.
- Terminal, title and HUD presentation styles: role colours, emphasis, title
  fade, CRT effects and the pulsing Anurati `A`.
- `desktop/assets/loading.svg` and
  `desktop/web/public/branding/robozium.svg`: the original lettering artwork.

The presentation runs as local HTML, CSS and checked JavaScript so it can appear
before TypeScript or Vite runs. It does not require React, application assets,
Docker, network access or project data. Character visibility changes preserve
the complete text layout. Reduced motion settles the introduction immediately.
Native startup ownership and IPC belong to `src/bootstrap.cjs`, separately from
these presentation assets.

`Anurati-Pro-Regular.woff2` is the same existing desktop status-mark font.
VT323's Latin font file comes from the reference's `@fontsource/vt323` package;
its license is retained in `assets/VT323-LICENSE.txt`.
