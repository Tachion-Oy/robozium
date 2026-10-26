// Copied from web/app/components/hud/projects/ProjectOverviewPanel.tsx at 5b06d82.
// Adapted: import paths. The setup lock and Start Here follow web at af87bea (#121).
// Rows are not buttons: Launch reads Open on a row with a run to open, Cancel is Stop.
import { useState } from "react"
import {
	isActiveRunStatus,
	isCurrentRunRow,
	ProjectStatus,
	type ProjectRow,
} from "../../projects/landing"
import { DisplayArt } from "../branding/DisplayArt"
import { HudButton } from "../hud/HudButton"

type ProjectOverviewPanelProps = {
	projects: ProjectRow[]
	currentRunId?: string | null
	navigationPending: boolean
	/** API keys are missing: every row is disabled and only Start Here works. */
	locked?: boolean
	onStartHere?: () => void
	onOpenProject: (project: ProjectRow) => void
	onSelectCapabilities: (project: ProjectRow) => void
	onLaunchProject: (project: ProjectRow) => void
	onNewProject: () => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}

const COLS = "grid-cols-[8rem_minmax(8rem,16rem)_5rem]"
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
					"agent-hud__row-status--running text-term-green [text-shadow:var(--term-glow-green)]",
			}
		case ProjectStatus.AwaitingUserInput:
			return {
				label: "WAITING",
				className:
					"agent-hud__row-status--waiting text-term-amber [text-shadow:var(--term-glow-amber)]",
			}
		case ProjectStatus.Opening:
			return {
				label: "OPENING",
				className: "agent-hud__row-status--opening",
			}
		case ProjectStatus.Cancelling:
			return {
				label: "STOPPING",
				className:
					"text-term-red [text-shadow:var(--term-glow-red)] opacity-80",
			}
		case ProjectStatus.Syncing:
			return {
				label: "SYNCING",
				className:
					"agent-hud__row-status--syncing text-[color:var(--term-lime)] [text-shadow:var(--term-glow-lime)]",
			}
		case ProjectStatus.Deleting:
			return {
				label: "DELETING",
				className:
					"text-term-red [text-shadow:var(--term-glow-red)] animate-pulse",
			}
		case ProjectStatus.Dormant:
			return { label: "DORMANT", className: `${HUD_TEXT} opacity-60` }
	}
}

function RowActions({
	project,
	canOpen,
	onOpenProject,
	onSelectCapabilities,
	onLaunchProject,
	onCancelRun,
	onDeleteProject,
}: {
	project: ProjectRow
	canOpen: boolean
	onOpenProject: (project: ProjectRow) => void
	onSelectCapabilities: (project: ProjectRow) => void
	onLaunchProject: (project: ProjectRow) => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false)

	const canCancel =
		isActiveRunStatus(project.status) ||
		project.status === ProjectStatus.Syncing
	const canDelete = project.status === ProjectStatus.Dormant
	const canLaunch = canDelete && project.runId === null

	return (
		<span
			className="agent-hud__row-actions shrink-0 flex justify-end gap-2">
			{canOpen ? (
				<HudButton
					aria-label={`Open ${project.slug}`}
					onClick={() => onOpenProject(project)}
					variant="success">
					Open
				</HudButton>
			) : (
				<HudButton
					disabled={!canLaunch}
					onClick={() => onLaunchProject(project)}
					variant="success">
					Launch
				</HudButton>
			)}
			<HudButton
				disabled={!canLaunch}
				onClick={() => onSelectCapabilities(project)}
				variant="info">
				Tools
			</HudButton>
			<HudButton
				disabled={!canCancel}
				onClick={() => onCancelRun(project)}
				variant="warning">
				Stop
			</HudButton>
			{confirmingDelete && canDelete ? (
				<HudButton
					onBlur={() => setConfirmingDelete(false)}
					onClick={() => {
						setConfirmingDelete(false)
						onDeleteProject(project)
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
	)
}

function ProjectRowItem({
	project,
	isCurrent,
	locked,
	onOpenProject,
	onSelectCapabilities,
	onLaunchProject,
	onCancelRun,
	onDeleteProject,
}: {
	project: ProjectRow
	isCurrent: boolean
	locked: boolean
	onOpenProject: (project: ProjectRow) => void
	onSelectCapabilities: (project: ProjectRow) => void
	onLaunchProject: (project: ProjectRow) => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}) {
	const display = statusDisplay(project.status, locked)
	// The current run, or another project's live run, opens; a dormant project launches.
	const canOpen = isCurrent || (isActiveRunStatus(project.status) && project.runId !== null)

	return (
		<li className="agent-hud__project-row flex items-center gap-2" aria-current={isCurrent ? "true" : undefined}>
			<div
				className={`agent-hud__project-summary flex-1 min-w-0 ${HUD_TEXT} text-[1.3rem] leading-tight tracking-[0.03em] py-1 pl-1`}>
				<span className={`grid ${COLS} gap-3 items-baseline`}>
					<span className={display.className}>{display.label}</span>
					<span
						className={`${HUD_TEXT} truncate${
							isCurrent ? " agent-hud__project-name--current" : ""
						}`}>
						{project.slug}
					</span>
					<span className={`${HUD_TEXT} opacity-80 text-[1rem]`}>
						{project.createdAt !== null
							? formatRelative(project.createdAt)
							: ""}
					</span>
				</span>
			</div>
			<RowActions
				project={project}
				canOpen={canOpen && !locked}
				onOpenProject={onOpenProject}
				onSelectCapabilities={onSelectCapabilities}
				onLaunchProject={onLaunchProject}
				onCancelRun={onCancelRun}
				onDeleteProject={onDeleteProject}
			/>
		</li>
	)
}

function ProjectsTable({
	projects,
	currentRunId,
	locked,
	onOpenProject,
	onSelectCapabilities,
	onLaunchProject,
	onCancelRun,
	onDeleteProject,
}: {
	projects: ProjectRow[]
	currentRunId: string | null
	locked: boolean
	onOpenProject: (project: ProjectRow) => void
	onSelectCapabilities: (project: ProjectRow) => void
	onLaunchProject: (project: ProjectRow) => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}) {
	return (
		<div className="agent-hud__projects-table space-y-2">
			<div className="agent-hud__table-header flex items-center gap-2 pb-2 mb-2">
				<span
					className={`grid ${COLS} gap-3 flex-1 min-w-0 pl-1 ${HUD_TEXT} text-[1.1rem] uppercase tracking-[0.12em] opacity-85`}>
					<span>Status</span>
					<span>Project</span>
					<span>Started</span>
				</span>
				<span
					className="agent-hud__row-actions shrink-0"
					aria-hidden="true"
				/>
			</div>
			<ul className="space-y-2">
				{projects.map((project) => (
					<ProjectRowItem
						key={project.slug}
						project={project}
						isCurrent={isCurrentRunRow(project, currentRunId)}
						locked={locked}
						onOpenProject={onOpenProject}
						onSelectCapabilities={onSelectCapabilities}
						onLaunchProject={onLaunchProject}
						onCancelRun={onCancelRun}
						onDeleteProject={onDeleteProject}
					/>
				))}
			</ul>
		</div>
	)
}

export function ProjectOverviewPanel({
	projects,
	currentRunId = null,
	navigationPending,
	locked = false,
	onStartHere,
	onOpenProject,
	onSelectCapabilities,
	onLaunchProject,
	onNewProject,
	onCancelRun,
	onDeleteProject,
}: ProjectOverviewPanelProps) {
	return (
		<div className="agent-hud__project-view flex min-h-0 w-full flex-1 flex-col gap-8">
			<fieldset
				disabled={navigationPending || locked}
				aria-busy={navigationPending}
				className="agent-hud__table-scroll m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 px-2 py-0">
				{projects.length > 0 ? (
					<ProjectsTable
						projects={projects}
						currentRunId={currentRunId}
						locked={locked}
						onOpenProject={onOpenProject}
						onSelectCapabilities={onSelectCapabilities}
						onLaunchProject={onLaunchProject}
						onCancelRun={onCancelRun}
						onDeleteProject={onDeleteProject}
					/>
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
					onClick={locked ? onStartHere : onNewProject}
					disabled={navigationPending}
					className="app-nav__cta agent-hud__start">
					<DisplayArt name={locked ? "start-here" : "new-project"} />
				</button>
			</div>
		</div>
	)
}
