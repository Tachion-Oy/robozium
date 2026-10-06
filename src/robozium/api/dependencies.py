"""Liveness, readiness, and cached dependency-health endpoints."""

from collections.abc import AsyncGenerator, Callable
from contextlib import AbstractAsyncContextManager, asynccontextmanager

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from roboz.dependencies import ExternalDependency, dedupe_external_dependencies
from roboz.shed.dependency_health import (
    DependencyHealthMonitor,
    DependencyRecord,
)

from robozium.hub.application import Hub

router = APIRouter()


def dependency_lifespan(
    hub: Hub,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncGenerator[None]:
        hub_dependencies: tuple[ExternalDependency, ...] = tuple(
            hub.model_selector.models.values()
        )
        if isinstance(hub.transcription_endpoint, ExternalDependency):
            hub_dependencies += (hub.transcription_endpoint,)
        dependencies = dedupe_external_dependencies(
            (
                *hub.definition.external_dependencies(),
                *hub_dependencies,
                *(hub.additional_dependencies or ()),
            )
        )
        monitor = DependencyHealthMonitor(
            dependencies,
            interval_s=hub.dependency_health.interval_s,
            timeout_s=hub.dependency_health.timeout_s,
        )
        application.state.dependency_health = monitor
        application.state.ready = True
        await monitor.start()
        try:
            yield
        finally:
            application.state.ready = False
            await monitor.stop()

    return lifespan


@router.get("/live")
def live() -> dict[str, str]:
    return {"status": "live"}


@router.get("/ready")
def ready(request: Request, response: Response) -> dict[str, str]:
    if not request.app.state.ready:
        response.status_code = 503
        return {"status": "not_ready"}
    return {"status": "ready"}


@router.get("/admin/dependencies", response_model=list[DependencyRecord])
def dependencies(request: Request) -> list[DependencyRecord]:
    monitor: DependencyHealthMonitor | None = request.app.state.dependency_health
    return [] if monitor is None else monitor.records()


@router.post(
    "/admin/dependencies/check",
    response_model=list[DependencyRecord],
)
async def check_dependencies(request: Request) -> list[DependencyRecord]:
    monitor: DependencyHealthMonitor | None = request.app.state.dependency_health
    if monitor is None:
        return []
    await monitor.run_once()
    return monitor.records()


@router.get(
    "/admin/dependencies/{dependency_id:path}",
    response_model=DependencyRecord,
)
def dependency(dependency_id: str, request: Request) -> DependencyRecord:
    monitor: DependencyHealthMonitor | None = request.app.state.dependency_health
    record = None if monitor is None else monitor.record(dependency_id)
    if record is None:
        raise HTTPException(status_code=404, detail="unknown dependency_id")
    return record


__all__ = ["dependency_lifespan", "router"]
