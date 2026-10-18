import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react"
import type { ProjectManagement } from "../../projects/useProjectManagement"
import type { Project } from "../../projects/projects-api"
import type { ProjectWork } from "../../app/useProjectWorkspace"
import { HudButton } from "../HudButton"
import "./projects.css"

interface ProjectsProps {
	management: ProjectManagement
	work: ProjectWork
	initialFocus?: string | null
}

/** Present collection management and workspace actions together in the overview. */
export function Projects({ management, work, initialFocus = null }: ProjectsProps): ReactElement {
	const [armed, setArmed] = useState<Project | null>(null)
	const buttons = useRef(new Map<string, HTMLButtonElement>())
	const nameInput = useRef<HTMLInputElement>(null)
	const lastRemoval = useRef(management.removed)

	useLayoutEffect(() => {
		if (initialFocus !== null) {
			(buttons.current.get(initialFocus) ?? nameInput.current)?.focus()
		}
	}, [initialFocus])

	useEffect(() => {
		if (!armed) return
		const project = management.projects.find(row => row.slug === armed.slug)
		const unchanged = project?.status === armed.status && project.runId === armed.runId
		if (!unchanged || !management.canDelete(armed.slug)) setArmed(null)
	}, [management, armed])

	useLayoutEffect(() => {
		// Consume new removals while visible; revisiting the view must not steal focus.
		if (management.removed && management.removed !== lastRemoval.current) {
			(buttons.current.get(management.removed.focus) ?? nameInput.current)?.focus()
		}
		lastRemoval.current = management.removed
	}, [management.removed])

	function confirmDeletion(project: Project): void {
		if (!management.canDelete(project.slug)) return
		if (armed?.slug === project.slug) {
			setArmed(null)
			management.deleteProject(project.slug)
		} else {
			setArmed(project)
		}
	}

	function renderProject(project: Project): ReactElement {
		const selected = work.selectedProject === project.slug
		const deleting = management.deleting.has(project.slug)
		const confirming = armed?.slug === project.slug
		const deleteLabel = deleting ? "Deleting…" : confirming ? "Confirm delete" : "Delete"
		let status = project.status.replaceAll("_", " ")
		if (deleting) status = "Deleting…"
		else if (work.cancelling.has(project.slug)) status = "Cancelling…"

		return (
			<li key={project.slug}>
				<HudButton
					ref={button => {
						if (button) buttons.current.set(project.slug, button)
						else buttons.current.delete(project.slug)
					}}
					aria-pressed={selected}
					onClick={() => work.selectProject(project.slug)}
				>
					{project.slug}{selected && <span aria-hidden="true"> ●</span>}
				</HudButton>
				<span role="status">{status}</span>
				<HudButton
					aria-label={`Cancel ${project.slug}`}
					variant="warning"
					disabled={!work.canCancelWork(project.slug)}
					onClick={() => work.cancelWork(project.slug)}
				>
					Cancel
				</HudButton>
				<HudButton
					variant="danger"
					disabled={!management.canDelete(project.slug)}
					aria-label={`${deleting ? "Deleting" : deleteLabel} ${project.slug}`}
					onBlur={() => setArmed(null)}
					onKeyDown={event => {
						if (event.key === "Escape") {
							event.preventDefault()
							setArmed(null)
						}
					}}
					onClick={() => confirmDeletion(project)}
				>
					{deleteLabel}
				</HudButton>
			</li>
		)
	}

	let listNotice = ""
	if (management.loading) listNotice = "Loading projects…"
	else if (!management.loadError && !management.projects.length) listNotice = "No projects yet."

	return (
		<section className="projects" aria-labelledby="projects-heading">
			<h2 id="projects-heading">Runs Overview</h2>
			<div className="projects__toolbar">
				<p role="status" title={work.selectedProject || undefined}>Selected project: {work.selectedProject || "None"}</p>
				<HudButton onClick={management.refresh}>Refresh</HudButton>
			</div>
			<p role="status">{listNotice}</p>
			{management.loadError && <p role="alert">Could not refresh projects: {management.loadError}</p>}
			{management.deleteError && <p role="alert">{management.deleteError}</p>}
			{work.error && <p role="alert">{work.error}</p>}
			<ul aria-label="Projects">{management.projects.map(renderProject)}</ul>
			<form onSubmit={event => { event.preventDefault(); management.createProject() }}>
				<label htmlFor="project-name">Project name</label>
				<input
					ref={nameInput}
					id="project-name"
					value={management.name}
					readOnly={management.creating}
					onChange={event => management.changeName(event.target.value)}
				/>
				<HudButton type="submit" variant="success" aria-disabled={!management.canCreate}>Create project</HudButton>
			</form>
			<p role="status">{management.creating ? "Creating project…" : ""}</p>
			{management.createError && <p role="alert">Could not create project: {management.createError}</p>}
		</section>
	)
}
