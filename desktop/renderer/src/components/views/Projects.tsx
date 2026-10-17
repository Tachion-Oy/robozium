import type { useProjects } from "../../api/useSelection"
import { HudButton } from "../hud/HudButton"
import "./projects.css"

export function Projects({ state }: { state: ReturnType<typeof useProjects> }) {
	return <section className="projects" aria-labelledby="projects-heading">
		<h2 id="projects-heading">Runs Overview</h2>
		<div className="projects__toolbar">
			<p role="status" title={state.selected || undefined}>Selected project: {state.selected || "None"}</p>
			<HudButton onClick={state.refresh}>Refresh</HudButton>
		</div>
		<p role="status">{state.read.pending ? "Loading projects…" : !state.read.error && !state.projects.length ? "No projects yet." : ""}</p>
		{state.read.error && <p role="alert">Could not refresh projects: {state.read.error}</p>}
		<ul aria-label="Projects">
			{state.projects.map(project => <li key={project.slug}>
				<HudButton aria-pressed={state.selected === project.slug} onClick={() => state.setSelected(project.slug)}>
					{project.slug}{state.selected === project.slug && <span aria-hidden="true"> ●</span>}
				</HudButton>
			</li>)}
		</ul>
		<form onSubmit={event => { event.preventDefault(); state.create() }}>
			<label htmlFor="project-name">Project name</label>
			<input id="project-name" value={state.name} readOnly={state.write.pending}
				onChange={event => state.setName(event.target.value)} />
			<HudButton type="submit" variant="success" aria-disabled={state.write.pending || !state.name.trim()}>Create project</HudButton>
		</form>
		<p role="status">{state.write.pending ? "Creating project…" : ""}</p>
		{state.write.error && <p role="alert">Could not create project: {state.write.error}</p>}
	</section>
}
