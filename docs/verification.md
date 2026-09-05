# Verification

## Release-quality CI implementation — 2026-09-05

These are local Linux results, not GitHub Actions results. Tooling: Python
3.13.3 and stable 3.14.7, Node 22.22.2, uv 0.12.10, the locked Playwright package,
and actionlint 1.7.12. The final application archives were built with the
reviewed Roboz dependency pin `f148023af667dc58c842d11f5a93843c2b0f1a8e`.
The sibling-checkout layout was reproduced in `/tmp/robosprawl-ci-repro` without
editing either manifest or lockfile.

| Command/check | Local result |
| --- | --- |
| `uv lock` | Passed; reviewed diff adds Pyright/Twine development dependencies, with no existing runtime version/range changes |
| `uv sync --locked --dev` | Passed on Python 3.13 and 3.14; exact pinned sibling checkout also passed |
| `uv run pytest --cov-fail-under=90` with JUnit/coverage output | 219 passed on both versions; exact pinned checkout coverage 91.89% / 91.64% respectively |
| `uv run ruff check src tests scripts` | Passed |
| `uv run pyright` | Passed with zero diagnostics, including the exact pinned dependency environment |
| `uv run pytest tests/contract --no-cov` (also in the full suite) | Six runtime schema/index-protocol contracts passed |
| `npm ci` in a fresh directory with the committed lockfile | Passed; reported the existing audit findings below |
| `npm --prefix web run typecheck` | Passed; all ten TypeScript test errors resolved without loosening validation |
| `npm --prefix web run test:run` | 310 passed across 42 files |
| `npm --prefix web run lint` | Passed |
| `ROBOSPRAWL_API_BASE_URL=http://127.0.0.1:8000 npm --prefix web run build` | Production build passed |
| `uv build --no-sources --all-packages --project ../roboz --out-dir <fresh-dir>` | Eight dependency archives built from the exact pin, once |
| `uv build --no-sources --out-dir <fresh-dir>` | Application wheel and source archive built; source archive contains 40 intended files and no local editor reports |
| `uv run twine check <fresh-dir>/*` | All ten archives passed |
| `uv run python scripts/check_distributions.py --dist <fresh-dir> --python-output <fresh-env>` | Original wheel and source-rebuilt wheel independently passed pip installs, pip check, installed import-location checks, three composition tests, and the real HTTP create/stream/reply/completion contract |
| `python scripts/e2e/check_runner.py` with an installed backend and prebuilt frontend | Occupied API/web ports, startup failure, actual failed browser test, and interruption all passed: diagnostics retained, no orphaned services, temporary data removed, user config/data unchanged |
| `bash scripts/e2e/run-mock-playwright.sh --project=webkit --grep='opens compact on landing\|an unknown run keeps' --repeat-each=10 --retries=0` | 20 passed: ten repetitions of each repaired scenario |
| Complete Chromium suite, `--project=chromium --retries=0` | 37 passed; unchanged visual baselines |
| Complete Firefox suite, `--project=firefox --retries=0` | 35 passed |
| Complete WebKit suite, `--project=webkit --retries=0` | 35 passed |
| `actionlint .github/workflows/*.yml` | Passed |
| `bash -n scripts/e2e/run-mock-playwright.sh scripts/test.sh scripts/verify-wheels.sh` | Passed |
| `uv run python scripts/audit-port.py` | Naming and preserved-license checks passed |
| `git diff --check` | Passed |

All final browser suites use `CI=1`, `ROBOSPRAWL_E2E_PREBUILT=1`, and
`ROBOSPRAWL_E2E_PYTHON=/tmp/robosprawl-final-browser-venv/bin/python`, with separate
local API/web port pairs. Chromium visual baselines were not changed. The new
restart scenario verifies persisted projects, stale running-state cleanup, and
opening a fresh run after the backend process is crashed and restarted.

Detailed local output is in `.artifacts/ci-*`, including Python/JUnit reports,
`ci-final-{build,twine,installed}.log`, `ci-runner-check-final.log`,
`ci-webkit-repeat-verified.log`, and the final per-browser logs. Each browser
invocation records a unique `.artifacts/e2e/run-*` directory containing traces,
screenshots on failure, HTML/JUnit reports, service logs, and cleanup results.
Candidate archives are in `/tmp/robosprawl-final-candidates`. CI retains its
corresponding reports and artifacts for 14 days.

README, contributor/testing instructions, the dependency-deferral notes, and
this verification record are updated. Unreleased entries describe the source
archive boundary and E2E runner. Runtime annotation corrections preserve the
HTTP schema and index behavior; no runtime APIs, prompts, persisted formats,
versions, or compatibility ranges were intentionally changed.

### Unrelated dependency gaps recorded without changing scope

The clean install's `npm audit --json` returned nonzero with 10 existing package
findings (nine high, one low). The direct Next.js dependency is among them;
full advisory details are in `.artifacts/ci-npm-audit.json`. No dependency
upgrades or automatic audit fixes were performed.

`web/lib/robosprawl/wire.ts` imports Zod at runtime, but `web/package.json` does
not directly declare it. `npm ls zod --all` shows it is currently supplied via
ESLint's dependency tree. The locked development install passes; dependency
ownership needs a separately scoped correction before a broader production
installation claim. The pre-existing `.VSCodeCounter/` directory is preserved.

### Verification limits

The actual GitHub Actions runs and fresh GitHub runner browser-system-library
installation have not been executed in this session. All three browser jobs
are required in the new CI, with flaky-only retry success rejected. Local Linux
browser results do not claim native Safari/macOS or Windows application support.
No live provider or publication operation was performed. The configured CI and
platform matrix must pass on GitHub before claiming that full acceptance matrix.

An anonymous GitHub API check of both repository URLs returned HTTP 404.
Public access to the pinned cross-repository dependency cannot currently be
verified; private or unpublished repositories will prevent credential-free
fork-PR checkout. This is an external prerequisite, not a reason to weaken the
required jobs or add a secret fallback. No repository visibility, push, tag, or
publication action was taken.

## Initial port record (superseded CI policy)

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

These were advisory in the initial port; the release-quality CI now requires all three browsers. No dependency or system-package changes were made to address them. Reproduce with `bash scripts/e2e/run-mock-playwright.sh --project=webkit hud-resize.spec.ts run-recovery.spec.ts`. Further investigation should distinguish WebKit pointer behavior and toast timing from application defects before changing either.

## Local artifacts

Detailed command output is gitignored under `.artifacts`: `pytest.log`, `vitest.log`, `ruff.log`, `eslint.log`, `e2e-chromium.log`, `e2e-firefox.log`, `e2e-webkit.log`, `visual-check.log`, `launch-check.log`, `wheels.log`, and `ci-path-check.log`. Browser reports live in `web/playwright-report` and `web/test-results`. Environments, caches, browser binaries, wheel staging, and temporary projects all remain inside RoboSprawl.

The CI workflow has been adapted and its path rewrite checked locally; it has not been executed on GitHub during this session. At that time Chromium and Firefox were required and WebKit was advisory. The current policy and results are recorded above.
