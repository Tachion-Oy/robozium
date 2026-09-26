# Contributing to Robozium

Anyone can contribute bug reports, fixes, examples, and documentation improvements.
Robozium is a repository-run application. Contributors work on this repository;
RoboZ, Shed, and Endpoints come from the dependency pinned in `uv.lock`.

## Choose the contribution path

- **Small fixes may go directly to a pull request:** typos, broken links, small
  documentation corrections, and obvious, narrowly scoped bug fixes that restore
  expected behavior without API or design changes.
- **Substantive changes require an approved issue first:** new features, changed
  public APIs, intentional behavior changes, significant bug fixes, refactors,
  architecture changes, performance rewrites, new dependencies, and breaking changes.

For substantive work, search
[existing issues](https://github.com/Tachion-Oy/robozium/issues), then open an
issue or join the relevant discussion. Explain the problem and proposed approach.
Wait for a maintainer to explicitly accept the proposal for implementation before
starting work or opening a substantial PR. Opening an issue is not approval.
If unsure which path applies, ask in an issue first.

`idea / bug → issue → maintainer triage → approval → implementation → PR → CI → review → merge`

Maintainers may close unapproved implementations without detailed review.
Report vulnerabilities privately through [Security](SECURITY.md).

## Getting started

For ordinary use, follow the [README](README.md#run). You can clone and run
Robozium without forking. To contribute, fork the repository on GitHub, clone
your fork, and create a branch for your change. Open a focused PR against `main`.

Replace `YOUR-USERNAME` below with your GitHub account:

```sh
git clone https://github.com/YOUR-USERNAME/robozium.git
cd robozium
git remote add upstream https://github.com/Tachion-Oy/robozium.git
git fetch upstream
git switch -c fix/describe-the-change upstream/main
```

Push your branch to your own `origin`, then open a PR against
`Tachion-Oy/robozium:main`. If you have write access to this repository, you can
create a branch here and follow the same PR process. Keep personal configuration,
credentials, and hub data out of the PR.

Install uv, Python 3.13 or newer, Node.js, and npm. CI uses Python 3.13 and
Node.js 22. From the repository root:

```sh
uv sync --locked --dev
npm --prefix web ci
```

Use `./start --mock` or `start.cmd --mock` to try the Docker application without
provider keys. Linux contributors can run `./scripts/dev.sh --mock` for native
development. See the [README](README.md#development-and-contributions) for ports
and the development launcher's separate hub storage.

Before changing code, read [Code style](docs/code-style.md) and
[Testing practices](docs/testing-practices.md). Shared framework or Shed behavior
belongs in [RoboZ](https://github.com/Tachion-Oy/roboz); discuss changes that span
both projects before implementing them.

## Validation

Run checks relevant to the change and include focused tests for changed behavior.
The [testing guide](docs/testing.md) gives the exact local commands, coverage gate,
and Full E2E policy. At minimum, check whitespace with `git diff --check`.

The required **CI** check covers Python and frontend tests, lint, and types.
Full E2E runs on pushes to `main` or manual dispatch; it is not the routine PR
gate. For changes to deployment, run lifecycle, persistence, or browser flows,
run the relevant integration checks described in the testing guide and report
their results. Documentation-only changes need link and command review rather
than new behavior tests.

For approved Python dependency changes, run `uv lock` and review the lockfile.
For approved frontend dependency changes, include the reviewed npm lockfile.
Do not include incidental dependency updates in an unrelated PR.

## Opening a pull request

Each PR should solve one problem. Substantive PRs must link their approved issue
and stay within its accepted scope. Discuss changes to the approach in the issue
first. Use `Fixes #123` or `Closes #123` when merging should resolve the issue;
small fixes do not require an issue.

Explain the problem, resulting behavior, and validation performed, including
checks you could not run. Update affected documentation and explain migration
steps for any intentional breaking changes. Exclude unrelated refactoring,
formatting, dependency changes, cleanup, and speculative improvements.

Add a short entry under `Unreleased` in [CHANGELOG.md](CHANGELOG.md) for
user-visible changes. Documentation, tests, and internal cleanup generally do
not need an entry unless a maintainer requests one. Leave version bumps, tags,
and releases to maintainers. Wheel and source archive checks are internal
validation; they do not imply publishing Robozium to PyPI.

## Responsibility and review

AI-assisted contributions are allowed. You are responsible for everything you
submit: understand, review, and validate it, and be able to explain and justify
the implementation. Generated code must meet the same standards as manually
written code. A large generated submission does not transfer the work of
understanding or validating it to maintainers. Low-quality, speculative,
mass-generated, or spam-like submissions may be closed.

Passing CI is necessary but does not guarantee acceptance. Maintainers retain
final discretion over scope, design, maintainability, and project direction.
Issue approval and submission do not create an obligation to merge.

## Reporting bugs

[Open an issue](https://github.com/Tachion-Oy/robozium/issues) with a minimal
reproduction, expected and actual behavior, commit or version, operating system,
and mock/live mode. Include Docker/Compose versions for deployment problems, or
Python and Node.js versions for native development. Remove credentials and
private project data from logs and examples.

## Repository protection

Maintainers configure protection for `main` in GitHub's repository settings,
following RoboZ's policy. These settings enforce the PR process:

- Require a pull request before merging, with **zero** mandatory approving
  reviews so a sole maintainer can merge their own PR. Maintainers still review
  community contributions. Dismiss stale approvals when new commits are pushed.
- Require the GitHub Actions **CI** status check and an up-to-date branch.
- Require conversation resolution before merging.
- Enforce the rules for administrators too; disable bypassing the requirements.
- Keep force pushes and branch deletion disabled.

Keep Full E2E as the existing post-merge/manual workflow, rather than requiring a
check that is not triggered on ordinary PRs. Enable private vulnerability
reporting for the process in [SECURITY.md](SECURITY.md). GitHub's
[branch protection guide](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule)
describes the settings.
