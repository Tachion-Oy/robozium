// Every project is one row with its status and buttons. Rows are not buttons: Launch reads
// Open on a row with a run to open. Cancel is red as the HUD's Cancel and Delete are: a row
// never offers Cancel and Delete together. A narrow row wraps its buttons onto a second
// line, starting at the left. A first listing that fails is reported in a toast with Retry
// instead of showing an empty hub.
import { useState } from "react"
import {
	isActiveRunStatus,
	ProjectStatus,
	type ProjectRow,
} from "../../projects/project-rows"
import type { ProjectQueryState } from "../../projects/useProjectQuery"
import type { ProjectMutations } from "../../projects/useProjectMutations"
import { DisplayArt } from "../branding/DisplayArt"
import { Toast } from "../feedback/Toast"
import { HudButton } from "../hud/HudButton"

type ProjectOverviewProps = {
	projects: ProjectQueryState
	/** A launch already in flight refuses another. */
	mutations: Pick<ProjectMutations, "launch" | "cancel" | "remove">
	navigationPending: boolean
	/** API keys are missing: every row is disabled and only Start Here works; it opens the guide. */
	locked: boolean
	onOpenRun: (runId: string, project: string) => void
	onSelectCapabilities: (project: string | null) => void
	onStartHere: () => void
}

// The status column's width is the theme's (project-overview.css).
const COLS = "grid-cols-[var(--status-column)_minmax(8rem,16rem)_5rem]"
const HUD_TEXT =
	"font-[family-name:var(--font-agent-input)] text-[color:var(--hud-input-text)]"

function formatRelative(createdAt: number): string {
	const delta = Math.max(0, Math.floor(Date.now() / 1000 - createdAt))
	if (delta < 60) return `${delta}s ago`
	const minutes = Math.floor(delta / 60)
	if (minutes < 60) return `${minutes}m ago`
	const hours = Math.floor(minutes / 60)
	return `${hours}h ago`
}

function statusDisplay(status: ProjectStatus, locked: boolean): {
	label: string
	className: string
} {
	if (locked) return { label: "DISABLED", className: `${HUD_TEXT} opacity-60` }
	switch (status) {
		case ProjectStatus.Running:
			return {
				label: "RUNNING",
				className:
					"agent-hud__row-status--running font-bold text-term-green [text-shadow:var(--term-glow-green)]",
			}
		case ProjectStatus.AwaitingUserInput:
			return {
				label: "WAITING",
				className:
					"agent-hud__row-status--waiting font-bold text-term-amber [text-shadow:var(--term-glow-amber)]",
			}
		case ProjectStatus.Opening:
			return {
				label: "OPENING",
				className: "agent-hud__row-status--opening font-bold",
			}
		case ProjectStatus.Cancelling:
			return {
				label: "CANCELLING",
				className:
					"font-bold text-term-red [text-shadow:var(--term-glow-red)] opacity-80",
			}
		case ProjectStatus.Syncing:
			return {
				label: "SYNCING",
				className:
					"agent-hud__row-status--syncing font-bold text-[color:var(--term-lime)] [text-shadow:var(--term-glow-lime)]",
			}
		case ProjectStatus.Deleting:
			return {
				label: "DELETING",
				className:
					"font-bold text-term-red [text-shadow:var(--term-glow-red)] animate-pulse",
			}
		case ProjectStatus.Dormant:
			return { label: "DORMANT", className: `${HUD_TEXT} opacity-60` }
	}
}

function ProjectRowItem({ project, locked, mutations, onOpenRun, onSelectCapabilities }: Pick<ProjectOverviewProps, "locked" | "mutations" | "onOpenRun" | "onSelectCapabilities"> & {
	project: ProjectRow
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false)
	const display = statusDisplay(project.status, locked)
	// A project at rest has a hollow lamp before its status in dark; any other a lit one.
	const live = !locked && project.status !== ProjectStatus.Dormant
	// A live run opens; a dormant project launches.
	const canOpen = !locked && isActiveRunStatus(project.status) && project.runId !== null
	const canCancel =
		isActiveRunStatus(project.status) ||
		project.status === ProjectStatus.Syncing
	const canDelete = project.status === ProjectStatus.Dormant
	const canLaunch = canDelete && project.runId === null

	return (
		<li className="agent-hud__project-row flex flex-wrap items-center gap-2">
			<div
				className={`agent-hud__project-summary ${HUD_TEXT} text-[1.3rem] leading-tight tracking-[0.03em] py-1 pl-1`}>
				<span className={`grid ${COLS} gap-3 items-baseline`}>
					<span className={`agent-hud__row-status ${display.className}`} data-live={live || undefined}>{display.label}</span>
					<span className={`${HUD_TEXT} truncate`}>{project.slug}</span>
					<span className={`${HUD_TEXT} opacity-80 text-[1rem]`}>
						{project.createdAt !== null
							? formatRelative(project.createdAt)
							: ""}
					</span>
				</span>
			</div>
			<span
				className="agent-hud__row-actions flex gap-2">
				{canOpen ? (
					<HudButton
						aria-label={`Open ${project.slug}`}
						onClick={() => { if (project.runId) onOpenRun(project.runId, project.slug) }}
						variant="success">
						Open
					</HudButton>
				) : (
					<HudButton
						disabled={!canLaunch}
						onClick={() => void mutations.launch({ project: project.slug, name: project.slug, selection: null })}
						variant="success">
						Launch
					</HudButton>
				)}
				<HudButton
					disabled={!canLaunch}
					onClick={() => onSelectCapabilities(project.slug)}
					variant="info">
					Edit
				</HudButton>
				<HudButton
					disabled={!canCancel}
					onClick={() => void mutations.cancel(project.slug)}
					variant="danger">
					Cancel
				</HudButton>
				{confirmingDelete && canDelete ? (
					<HudButton
						onBlur={() => setConfirmingDelete(false)}
						onClick={() => {
							setConfirmingDelete(false)
							void mutations.remove(project.slug)
						}}
						variant="danger-confirm">
						Confirm?
					</HudButton>
				) : (
					<HudButton
						disabled={!canDelete}
						onClick={() => setConfirmingDelete(true)}
						variant="danger">
						Delete
					</HudButton>
				)}
			</span>
		</li>
	)
}

export function ProjectOverview({ projects, mutations, navigationPending, locked, onOpenRun, onSelectCapabilities, onStartHere }: ProjectOverviewProps) {
	if (projects.isInitialLoading) {
		return (
			<div
				className="agent-hud__project-view agent-hud__overview-loading"
				role="status">
				<span>Refreshing project status</span>
				<span
					className="agent-hud__overview-loading-dots"
					aria-hidden="true">
					...
				</span>
			</div>
		)
	}
	// The toast reports the failure; the view stays empty rather than claiming no projects.
	if (projects.loadError !== null) return <div className="agent-hud__project-view agent-hud__overview-loading">
		<Toast tone="error" title="Could not load projects" message={projects.loadError} actions={[{ label: "Retry", onClick: projects.refresh }]} />
	</div>

	return (
		<div className="agent-hud__panel agent-hud__project-view flex min-h-0 w-full flex-1 flex-col gap-8">
			<fieldset
				disabled={navigationPending || locked}
				aria-busy={navigationPending}
				className="agent-hud__table-scroll m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 px-2 py-0">
				{projects.rows.length > 0 ? (
					<div className="agent-hud__projects-table space-y-2">
						<div className="agent-hud__table-header flex items-center gap-2 pb-2 mb-2">
							<span
								className={`grid ${COLS} gap-3 flex-1 min-w-0 pl-1 ${HUD_TEXT} text-[1.1rem] uppercase tracking-[0.12em] opacity-85`}>
								<span className="agent-hud__status-heading">Status</span>
								<span>Project</span>
								<span>Started</span>
							</span>
							<span
								className="agent-hud__row-actions shrink-0"
								aria-hidden="true"
							/>
						</div>
						<ul className="space-y-2">
							{projects.rows.map((project) => (
								<ProjectRowItem key={project.slug} project={project} locked={locked} mutations={mutations}
									onOpenRun={onOpenRun} onSelectCapabilities={onSelectCapabilities} />
							))}
						</ul>
					</div>
				) : (
					<p
						className={`text-center uppercase tracking-[0.14em] ${HUD_TEXT} text-[1.3rem]`}>
						No projects
					</p>
				)}
			</fieldset>

			<div className="flex justify-center">
				<button
					type="button"
					onClick={locked ? onStartHere : () => onSelectCapabilities(null)}
					disabled={navigationPending}
					className="agent-hud__start">
					<DisplayArt name={locked ? "start-here" : "new-project"} />
				</button>
			</div>
		</div>
	)
}
