"""Liveness, readiness, and cached dependency-health endpoints."""

import tempfile
from collections.abc import AsyncGenerator, Callable, Sequence
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from dataclasses import replace
from pathlib import Path

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from roboz.llm import TranscriptionEndpointLike
from roboz.tooling import ExternalDependency, ExternalDependencyKind

from robosprawl.dependency_contract import (
    BoundDependency,
    DependencyContractError,
    DependencyRegistration,
    bind_dependencies,
)
from robosprawl.dependency_health import (
    DependencyHealthMonitor,
    DependencyRecord,
    check_executable,
    check_openai_compatible_endpoint,
)
from robosprawl.orchestrator_factory import (
    OrchestratorEndpointGetter,
    OrchestratorFactory,
)
from robosprawl.workspace import Project

router = APIRouter()


def inspect_dependencies(
    factory: OrchestratorFactory,
    *,
    project: Project,
    endpoint_getter: OrchestratorEndpointGetter,
    registrations: Sequence[DependencyRegistration] | None,
    hub_dependencies: Sequence[ExternalDependency] = (),
) -> tuple[BoundDependency, ...]:
    with tempfile.TemporaryDirectory(prefix="robosprawl-dependency-inspection-") as raw:
        project = replace(
            project,
            sandbox=replace(project.sandbox, root=Path(raw)),
        )
        built = factory(project, endpoint_getter=endpoint_getter, event_sinks=())
        agents = (built.agent, *built.background_agents)
        discovered = [
            dependency
            for agent in agents
            for dependency in agent.external_dependencies()
        ]
        discovered.extend(hub_dependencies)
        if registrations is None:
            checks = {
                ExternalDependencyKind.EXECUTABLE: check_executable,
                ExternalDependencyKind.MODEL_ENDPOINT: check_openai_compatible_endpoint,
            }
            unique = {item.dependency_id: item for item in discovered}
            if any(item.kind not in checks for item in unique.values()):
                raise DependencyContractError(
                    "custom dependency kind requires an explicit checker registration"
                )
            registrations = tuple(
                DependencyRegistration(item.dependency_id, item.kind, checks[item.kind])
                for item in unique.values()
            )
        return bind_dependencies(discovered, registrations)


def dependency_lifespan(
    *,
    factory: OrchestratorFactory,
    project: Project,
    endpoint_getter: OrchestratorEndpointGetter,
    transcription_endpoint: TranscriptionEndpointLike | None,
    selectable_endpoints: Sequence[ExternalDependency] = (),
    registrations: Sequence[DependencyRegistration] | None,
    interval_s: float,
    timeout_s: float,
) -> Callable[[FastAPI], AbstractAsyncContextManager[None]]:
    @asynccontextmanager
    async def lifespan(application: FastAPI) -> AsyncGenerator[None]:
        hub_dependencies = tuple(selectable_endpoints)
        if isinstance(transcription_endpoint, ExternalDependency):
            hub_dependencies += (transcription_endpoint,)
        dependencies = inspect_dependencies(
            factory,
            project=project,
            endpoint_getter=endpoint_getter,
            registrations=registrations,
            hub_dependencies=hub_dependencies,
        )
        monitor = DependencyHealthMonitor(
            dependencies,
            interval_s=interval_s,
            timeout_s=timeout_s,
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


__all__ = ["dependency_lifespan", "inspect_dependencies", "router"]
