"""Explicit ownership of application startup and shutdown resources."""

import asyncio
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from robozium.api.dependencies import dependency_lifespan
from robozium.api.project_service import ProjectService
from robozium.api.run_manager import RunManager
from robozium.backend_logging import backend_logging_context
from robozium.hub.application import Hub


def application_lifespan(
    *,
    deployment: Hub,
    manager: RunManager,
    projects: ProjectService,
):
    dependencies = dependency_lifespan(deployment)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncGenerator[None]:
        with backend_logging_context(deployment.settings.logging):
            try:
                projects.recover()
                async with dependencies(app):
                    yield
            finally:
                app.state.ready = False
                await asyncio.to_thread(manager.shutdown)

    return lifespan
