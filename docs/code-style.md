# Code style

Match the surrounding code and keep changes focused. Contribution scope and
breaking-change expectations are in [Contributing](../CONTRIBUTING.md);
validation commands are in [Testing](testing.md).

## Python and typing

Support Python 3.13, the minimum declared in [pyproject.toml](../pyproject.toml).
That file defines Ruff's lint rules. [pyrightconfig.json](../pyrightconfig.json)
defines source type checking, including the checked-in hub configuration.

Annotate public inputs and outputs. Use the concrete RoboZ endpoint, deployment,
and event contracts rather than untyped substitutes. Keep Pydantic models,
serialized payloads, and consumers consistent when an API changes. Avoid broad
`Any` annotations or type suppressions that hide a contract problem.

## Application boundaries

Keep application configuration and deployment bindings in `robozium.hub`, HTTP
and run lifecycle behavior in `robozium.api`, and scripted behavior in
`robozium.mock`. The application consumes RoboZ's agents, capabilities, tools,
and provider catalogue; reusable changes to those components belong upstream.

Module imports must not start agents, perform provider requests, configure
process-wide logging, or create hub files. The application lifespan owns startup,
shutdown, and logging. Bind runtime state to each run rather than sharing mutable
agent state between projects.

Treat HTTP/SSE payloads, configuration choices, persisted paths, and credentials
as contracts. Keep backend models and frontend wire types aligned. Preserve one
API worker per hub directory and the private API network in Compose.

## Frontend

Use TypeScript's strict checks and the existing Next.js ESLint configuration.
Match the local React and CSS conventions; avoid unrelated formatting changes.
Before frontend work, follow the version-specific instructions in
[web/AGENTS.md](../web/AGENTS.md).

Keep transport types and parsing in `web/lib/robozium`, session state in its
existing reducers and hooks, and presentation in components. Respect Next.js
server/client boundaries. Provider credentials and the upstream API URL belong
on the server; never expose credentials through public frontend configuration.

## Docstrings and prompts

Explain behavior, constraints, ownership, and side effects that names and
annotations cannot convey. Match the surrounding docstring style; use `Args`,
`Returns`, or `Raises` sections when they add useful information.

RoboZ exposes tool and factory docstrings to the model as instructions. Write
them to explain when to use the tool, what it does, and its constraints. Keep
implementation notes in comments and avoid repeating the input schema. Apply
the same care to skill instructions and model-visible field descriptions.

## Configuration and private data

Keep Compose behavior in configuration and executable code, with documentation
describing it rather than introducing another source of defaults. Keep provider
credentials in runtime environment files. Review changes to tracked
`hub.config.py` so personal choices do not enter an unrelated contribution.

Do not add credentials, private hub data, or generated diagnostic artifacts to
Git. Test behavior with temporary directories and deterministic collaborators
as described in [Testing practices](testing-practices.md).
