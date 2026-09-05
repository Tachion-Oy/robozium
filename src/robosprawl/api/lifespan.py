"""Explicit ownership of application startup and shutdown resources."""

import asyncio
from collections.abc import AsyncGenerator, Sequence
from contextlib import asynccontextmanager

from fastapi import FastAPI

from robosprawl.api.dependencies import dependency_lifespan
from robosprawl.api.project_service import ProjectService
from robosprawl.api.run_manager import RunManager
from robosprawl.backend_logging import backend_logging_context
from robosprawl.dependency_contract import DependencyRegistration
from robosprawl.deployment import HubDeployment


def application_lifespan(
    *,
    deployment: HubDeployment,
    manager: RunManager,
    projects: ProjectService,
    registrations: Sequence[DependencyRegistration] | None,
    interval_s: float,
    timeout_s: float,
):
    dependencies = dependency_lifespan(
        factory=deployment.orchestrator_factory,
        endpoint_getter=lambda: deployment.model_selector.selected_endpoint,
        project=deployment.config.project(deployment.config.name),
        transcription_endpoint=deployment.transcription_endpoint,
        selectable_endpoints=deployment.inspectable_endpoints,
        registrations=registrations,
        interval_s=interval_s,
        timeout_s=timeout_s,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        with backend_logging_context(deployment.config.logging):
            try:
                projects.recover()
                async with dependencies(app):
                    yield
            finally:
                app.state.ready = False
                await asyncio.to_thread(manager.shutdown)

    return lifespan
