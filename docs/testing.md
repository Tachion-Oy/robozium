# Testing

The `CI` workflow runs Python tests, lint, and types, plus frontend tests, lint, and types on pull requests and pushes to `main`. `Full E2E` runs on pushes to `main` and manual dispatch.

`Full E2E` starts four independent jobs: Chromium, Firefox, WebKit, and Docker onboarding with restart recovery. Browser jobs each build the production frontend, install the candidate backend and only their selected browser, then use one Playwright worker and one API worker with a temporary hub. Chromium additionally checks the wheel and source distribution and exercises runner cleanup paths. Docker uses its own fresh runner. A browser job finishing early or failing does not cancel the others.

Chromium and Firefox have 15-minute browser runner deadlines and 25-minute job limits. WebKit has a 25-minute runner deadline and a 35-minute job limit. Docker has a 15-minute job limit. Browser jobs allow one retry and stop after three failed tests. Flaky tests fail. Playwright output streams to Actions; browser, backend, frontend, resource, and technical logs remain in the diagnostic artifact.

An ordinary, fully completed WebKit test failure is advisory. An interrupted or timed-out suite, three-failure termination, top-level Playwright error, missing completion report, service exit, or runner or browser-fixture setup/cleanup error fails the job for every browser. The browser runner writes `result.json` and Playwright writes `completion.json` so the evaluator can distinguish these outcomes. Failure reports upload before the job limit.

Locally, install dependencies with `uv sync --locked --dev` and `npm --prefix web ci`, then run `npm --prefix web run test:e2e` for Chromium or `npm --prefix web run test:e2e:all-browsers` for all browsers. The runner creates a disposable hub and writes diagnostics under `.artifacts/e2e/`.
