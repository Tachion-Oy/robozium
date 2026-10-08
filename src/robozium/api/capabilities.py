"""Capability discovery and independent project selection persistence."""

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import StrictBool, TypeAdapter
from roboz.deployment import SkillLabel, SkillLoading, ToolLabel
from roboz.runtime.persistence import atomic_write_json

from robozium.api.models import CapabilityView
from robozium.api.project_service import ProjectService
from robozium.api.projects import Project
from robozium.api.state import CapabilitySelection
from robozium.hub.application import Hub

router = APIRouter(prefix="/capabilities")
_SELECTION = TypeAdapter(dict[str, StrictBool | SkillLoading])


@contextmanager
def _project(request: Request, slug: str) -> Iterator[Project]:
    projects: ProjectService = request.app.state.projects
    try:
        with projects.access(slug) as project:
            yield project
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="unknown project") from exc
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=list[CapabilityView])
def catalogue(request: Request, response: Response) -> list[ToolLabel | SkillLabel]:
    hub: Hub = request.app.state.hub
    response.headers["Cache-Control"] = "no-store"
    return hub.capabilities()


@router.get("/{slug}", response_model=dict[str, bool | SkillLoading] | None)
def read_selection(
    slug: str, request: Request, response: Response
) -> CapabilitySelection | None:
    """Return stored choices unchanged, or null if none have been saved."""
    response.headers["Cache-Control"] = "no-store"
    with _project(request, slug) as project:
        try:
            return _SELECTION.validate_json(project.capabilities_file.read_bytes())
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as exc:
            raise HTTPException(
                status_code=500,
                detail="Could not read saved capabilities. Repair or remove "
                ".robozium/capabilities.json in this project, then retry.",
            ) from exc


@router.post("/{slug}", response_model=dict[str, bool | SkillLoading])
def write_selection(
    slug: str,
    selection: dict[str, StrictBool | SkillLoading],
    request: Request,
    response: Response,
) -> CapabilitySelection:
    """Replace saved choices without consulting the catalogue or changing a run."""
    response.headers["Cache-Control"] = "no-store"
    with _project(request, slug) as project:
        try:
            atomic_write_json(project.capabilities_file, selection)
        except (OSError, ValueError) as exc:
            raise HTTPException(
                status_code=500, detail="Could not save project capabilities"
            ) from exc
    return selection
