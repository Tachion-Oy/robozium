import type { Project } from "./wire"

/**
 * The landing is project-centric: every project is one row. "Running"/"waiting"
 * is just the status of a project that currently has a live run; everything else
 * is "dormant" — it exists on disk and can be resumed (its memory is loaded when
 * a new run starts). A dormant row has no `runId` yet; clicking it mints one.
 */
export enum ProjectStatus {
	Running = "running",
	AwaitingUserInput = "awaiting_user_input",
	Opening = "opening",
	Cancelling = "cancelling",
	Syncing = "syncing",
	Deleting = "deleting",
	Dormant = "dormant",
}

export type ProjectRow = {
	slug: string
	status: ProjectStatus
	runId: string | null
	agentName: string | null
	createdAt: number | null
}

/**
 * Convert the backend-composed project list into the UI's row shape.
 * The backend owns status precedence; the client only renders it.
 */
export function mergeProjects(projects: Project[]): ProjectRow[] {
	return projects.map((project) => ({
		slug: project.slug,
		status: project.status as ProjectStatus,
		runId: project.run_id,
		agentName: project.current_agent_name,
		createdAt: project.created_at,
	}))
}

/** Optimistically mark the projects with active cancel intent as cancelling. */
export function markProjectsCancelling(
	rows: ProjectRow[],
	slugs: Iterable<string>,
): ProjectRow[] {
	const targets = new Set(slugs)
	if (targets.size === 0) return rows
	return rows.map((row) =>
		targets.has(row.slug) ? { ...row, status: ProjectStatus.Cancelling } : row,
	)
}

/** Optimistically mark the one project whose run is being opened. */
export function markProjectOpening(
	rows: ProjectRow[],
	slug: string | null,
): ProjectRow[] {
	if (!slug) return rows
	return rows.map((row) =>
		row.slug === slug ? { ...row, status: ProjectStatus.Opening } : row,
	)
}

export function markProjectsDeleting(
	rows: ProjectRow[],
	slugs: Iterable<string>,
): ProjectRow[] {
	const targets = new Set(slugs)
	if (targets.size === 0) return rows
	return rows.map((row) =>
		targets.has(row.slug) ? { ...row, status: ProjectStatus.Deleting } : row,
	)
}
