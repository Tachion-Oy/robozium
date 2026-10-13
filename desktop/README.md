# Robozium

The Electron app is under development. It currently shows the application name
and version, with a button to switch between dark and light themes.

## Run on Linux

Requires Node.js 22.12 or newer and npm. From the repository root:

```sh
npm --prefix desktop ci
npm --prefix desktop start
```

Close and restart the app to rebuild after changes. Local app data is stored in
`.artifacts/desktop/scaffold/`.

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
