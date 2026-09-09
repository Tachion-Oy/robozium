# Deployment validation against merged Roboz

Validated locally on Linux on 2026-09-09 against Roboz `303384eda389e2193af43a7dbec38d3193cd6741`
(merged PR #22). Runtime sources and candidate archives are from RoboSprawl
`c98757121ad00e4f9e73661bef3320742e3bd11f`; final browser tests include the test-only
artifact assertion correction in `781f085`. No runtime sources, dependency
versions, lockfiles, timeouts, visual baselines, or CI failure policies changed
during validation.

Used isolated sibling source copies under
`.artifacts/merged-validation-303384e/`, preserving the active Roboz worktree.
Python 3.13.3 and 3.14.7, Node 22.22.2, and CI-pinned uv 0.12.10 were used.
Locked environment setup succeeded against the merged source without rewriting
metadata or the lockfile.

## Results

| Gate | Result |
| --- | --- |
| Python 3.13 | 285 passed; 95.51% coverage |
| Python 3.14 | 285 passed; 95.38% coverage |
| Ruff and Pyright | Passed |
| Frontend lint and TypeScript | Passed |
| Frontend unit tests | 331 passed across 44 files |
| Fresh production frontend build | Passed |
| Fresh wheel and source archives; Twine | Passed |
| Independent wheel and rebuilt-sdist installations | Both passed `pip check`, five composition tests, and installed HTTP/persistence smoke checks |
| Runner cleanup | All five occupied-port, startup-failure, failed-test, and interruption cases passed |
| Chromium | 39/39 passed |
| Firefox | 37/37 passed |
| WebKit full | 35/37 passed; 2 failed (advisory) |
| WebKit stress | 20/20 passed |

Both Python coverage results exceed the existing 90% floor. Browser runs use the
freshly installed backend wheels and freshly built production frontend, with
zero retries and snapshot updates disabled. Final browser controllers removed
their temporary workspaces and stopped their owned services.

Completed WebKit test failures are advisory under the existing CI policy;
setup and cleanup remain required. Failing scenarios:

- Scroll scenario: Send remained disabled beyond its five-second readiness assertion.
- Light-theme scenario: the agent indicator remained `working` instead of `awaiting-input` beyond its five-second assertion.

## Findings and corrections

The first browser attempt ran four suites concurrently. Firefox exposed an
artifact-read race: the lifecycle assertion saw a new snapshot before its
contents were written. The snapshot and memory assertions now poll for the same
required text, using existing timeouts. The same correction covers the Librarian
retention scenario. There was no production-code change.

The concurrent attempt also had one Chromium and one Firefox navigation timeout
while the machine was heavily loaded. The final sequential runs passed both
unchanged scenarios. Both initial WebKit jobs were stopped cleanly and rerun;
those interrupted attempts are not counted as successful checks. Initial failures
and interrupted-run diagnostics remain retained alongside the final results.

## Reproduction and retained evidence

Use the commands in [CI-equivalent validation](testing.md) with sibling source
checkouts at the recorded revisions. This run used separate Python environments
and pytest/coverage output paths, then:

- `ruff check src tests scripts hub.config.py` and `pyright`.
- `npm ci`, frontend lint, TypeScript, all Vitest tests, and `npm run build`.
- Fresh `uv build --no-sources` archives for all dependency packages and the app,
  `twine check`, and `scripts/check_distributions.py --python-output <fresh-env>`.
- `scripts/e2e/check_runner.py`, followed by complete Chromium, Firefox, and WebKit
  suites and the 20-case WebKit stress command, all with `--retries=0`.

Logs, coverage XML, JUnit reports, exact archive SHA-256 hashes, and source revisions
are under `.artifacts/merged-validation-303384e/robosprawl/.artifacts/reports/`.
Browser traces, screenshots, logs, and cleanup results are in the adjacent `e2e/`
directory. `source-and-archive-manifest.json` and `final-browser-results.json`
identify the exact inputs and final browser reports. This records local gate
results, not a new GitHub Actions run.
