// Rows come from the desktop projects API, already in camel case; the marks below are this app's own.
/**
 * Runs Overview is project-centric: every project is one row. "Running"/"waiting"
 * is just the status of a project that currently has a live run; everything else
 * is "dormant" — it exists on disk and can be resumed (its memory is loaded when
 * a new run starts). Clicking a dormant row opens the capability selector.
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
	/** Seconds since the epoch, or null when the backend does not know. */
	createdAt: number | null
}

export function isActiveRunStatus(status: ProjectStatus): boolean {
	return (
		status === ProjectStatus.Running ||
		status === ProjectStatus.AwaitingUserInput
	)
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
