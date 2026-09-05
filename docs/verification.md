# Port verification

Verified locally on 2026-09-05 with Python 3.13.3, Node.js 22.22.2, and uv 0.6.14. The Roboz revision is `f148023af667dc58c842d11f5a93843c2b0f1a8e`. The source hub reference is `da71c1f7208204f197751abe031a48042e282ea6`; the source composition reference is `2c701486acd77baeaf80d6834d1f52d2cf08d5b3`.

| Check | Result |
| --- | --- |
| Python unit and composition tests | 213 passed; 92% application coverage |
| Frontend unit tests | 310 passed across 42 files |
| Ruff and ESLint | Passed |
| Chromium E2E | 36 passed; both visual scenarios also passed separately with snapshot updates disabled |
| Firefox E2E | 34 passed |
| WebKit E2E (advisory) | 32 passed; 2 failed, detailed below |
| Actual launchers | Default mock and `--live` each served API/UI, passed readiness, and shut down both services; live correctly reported missing credentials |
| Wheel installation | Built all four wheels in local staging; installed in a fresh environment; verified imports come from that environment and mock readiness succeeds |
| CI source-path rewrite | Local reproduction passes `uv sync --locked` with the complete Roboz workspace inside the checkout |
| Shell syntax / CI YAML | Passed |
| Naming and license audit | No historical naming family in candidate tracked filenames/text; original LICENSE bytes preserved |
| External repositories | Source hub, source composition repository, and Roboz retain their pre-port Git status |

Tests run without service credentials. Automated live configuration checks verify the explicit provider options, missing-credential reporting, and HTTP 503 for live transcription. No credential-backed inference smoke test was run.

## Visual review

The desktop dark/light landing views retain the existing terminal and HUD layouts. Intentional changes are RoboSprawl branding, a generic `robosprawl@local` terminal prompt, a robot favicon, and dependency fixtures showing retained read tools/model endpoints. The header, project rows, controls, and dependency-table layout were visually inspected. Baseline changes are stored under `web/e2e/visual-regression.spec.ts-snapshots`.

Two inherited CSS probes were made deterministic: assertions resolve current animated landing rows, and the hover-paint probe has its own stable DOM container. The theme-hover check reacquires the pointer target after streamed content moves the HUD. No production CSS behavior was weakened for these checks.

## Advisory WebKit findings

The 34-test WebKit run finished with 32 passes and two failures. Both equivalent Chromium and Firefox scenarios pass.

- `hud-resize.spec.ts:145`: the simulated drag did not move the minimized status widget horizontally; its x coordinate remained unchanged.
- `run-recovery.spec.ts:49`: clicking the unknown-run toast's dismiss button timed out after that element detached from the DOM. The preceding return-home and stop-polling assertions passed.

These remain advisory, as specified for this port. No dependency or system-package changes were made to address them. Reproduce with `bash scripts/e2e/run-mock-playwright.sh --project=webkit hud-resize.spec.ts run-recovery.spec.ts`. Further investigation should distinguish WebKit pointer behavior and toast timing from application defects before changing either.

## Local artifacts

Detailed command output is gitignored under `.artifacts`: `pytest.log`, `vitest.log`, `ruff.log`, `eslint.log`, `e2e-chromium.log`, `e2e-firefox.log`, `e2e-webkit.log`, `visual-check.log`, `launch-check.log`, `wheels.log`, and `ci-path-check.log`. Browser reports live in `web/playwright-report` and `web/test-results`. Environments, caches, browser binaries, wheel staging, and temporary projects all remain inside RoboSprawl.

The CI workflow has been adapted and its path rewrite checked locally; it has not been executed on GitHub during this session. Chromium and Firefox are required; WebKit is advisory.
