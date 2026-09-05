"use client"

import { useState } from "react"
import { ProjectStatus, type ProjectRow } from "@/lib/robosprawl/landing"
import { CreateRunForm } from "./CreateRunForm"

type LandingPanelProps = {
	projects: ProjectRow[]
	currentProjectSlug?: string | null
	isStarting: boolean
	onProjectClick: (project: ProjectRow) => void
	onCreateRunSubmit: (projectName: string) => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}

const COLS = "grid-cols-[8rem_minmax(8rem,1fr)_10rem_5rem]"
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

function statusDisplay(status: ProjectStatus): {
	label: string
	className: string
} {
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
				label: "CANCELLING",
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

const ACTIONS = "w-44 shrink-0"

function RowActions({
	project,
	onCancelRun,
	onDeleteProject,
}: {
	project: ProjectRow
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false)

	const canCancel =
		project.status === ProjectStatus.Running ||
		project.status === ProjectStatus.AwaitingUserInput ||
		project.status === ProjectStatus.Syncing
	const canDelete = project.status === ProjectStatus.Dormant

	return (
		<span
			className={`${ACTIONS} agent-hud__row-actions flex justify-end gap-2`}>
			<button
				type="button"
				disabled={!canCancel}
				onClick={() => onCancelRun(project)}
				className="agent-hud__row-action agent-hud__row-cancel">
				Cancel
			</button>
			{confirmingDelete && canDelete ? (
				<button
					type="button"
					onBlur={() => setConfirmingDelete(false)}
					onClick={() => {
						setConfirmingDelete(false)
						onDeleteProject(project)
					}}
					className="agent-hud__row-action agent-hud__row-delete agent-hud__row-delete--confirm">
					Confirm?
				</button>
			) : (
				<button
					type="button"
					disabled={!canDelete}
					onClick={() => setConfirmingDelete(true)}
					className="agent-hud__row-action agent-hud__row-delete">
					Delete
				</button>
			)}
		</span>
	)
}

function ProjectRowItem({
	project,
	isCurrent,
	onProjectClick,
	onCancelRun,
	onDeleteProject,
}: {
	project: ProjectRow
	isCurrent: boolean
	onProjectClick: (project: ProjectRow) => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}) {
	const display = statusDisplay(project.status)
	const canOpen =
		isCurrent ||
		project.status === ProjectStatus.Running ||
		project.status === ProjectStatus.AwaitingUserInput ||
		project.status === ProjectStatus.Dormant

	return (
		<li className="agent-hud__project-row flex items-center gap-2">
			<button
				type="button"
				aria-label={`${isCurrent ? "Return to" : "Open"} ${project.slug}`}
				aria-current={isCurrent ? "true" : undefined}
				disabled={!canOpen}
				onClick={() => onProjectClick(project)}
				className={`flex-1 min-w-0 text-left ${HUD_TEXT} text-[1.3rem] leading-tight tracking-[0.03em] rounded py-1 pl-1 transition-colors ${
					canOpen
						? "cursor-pointer hover:bg-[rgba(64,200,255,0.10)] hover:brightness-125 focus-visible:bg-[rgba(64,200,255,0.10)] focus-visible:brightness-125"
						: "cursor-not-allowed"
				}`}>
				<span className={`grid ${COLS} gap-3 items-baseline`}>
					<span className={display.className}>{display.label}</span>
					<span
						className={`${HUD_TEXT} truncate${
							isCurrent ? " agent-hud__project-name--current" : ""
						}`}>
						{project.slug}
					</span>
					<span className="text-term-blue text-shadow:var(--term-glow-blue) truncate">
						{project.agentName ?? ""}
					</span>
					<span className={`${HUD_TEXT} opacity-80 text-[1rem]`}>
						{project.createdAt !== null
							? formatRelative(project.createdAt)
							: ""}
					</span>
				</span>
			</button>
			<RowActions
				project={project}
				onCancelRun={onCancelRun}
				onDeleteProject={onDeleteProject}
			/>
		</li>
	)
}

function ProjectsTable({
	projects,
	currentProjectSlug,
	onProjectClick,
	onCancelRun,
	onDeleteProject,
}: {
	projects: ProjectRow[]
	currentProjectSlug: string | null
	onProjectClick: (project: ProjectRow) => void
	onCancelRun: (project: ProjectRow) => void
	onDeleteProject: (project: ProjectRow) => void
}) {
	return (
		<div className="space-y-2">
			<div className="agent-hud__table-header flex items-center gap-2 pb-2 mb-2">
				<span
					className={`grid ${COLS} gap-3 flex-1 min-w-0 pl-1 ${HUD_TEXT} text-[1.1rem] uppercase tracking-[0.12em] opacity-85`}>
					<span>Status</span>
					<span>Project</span>
					<span>Agent</span>
					<span>Started</span>
				</span>
				<span
					className={ACTIONS}
					aria-hidden="true"
				/>
			</div>
			<ul className="space-y-2">
				{projects.map((project) => (
					<ProjectRowItem
						key={project.slug}
						project={project}
						isCurrent={project.slug === currentProjectSlug}
						onProjectClick={onProjectClick}
						onCancelRun={onCancelRun}
						onDeleteProject={onDeleteProject}
					/>
				))}
			</ul>
		</div>
	)
}

export function LandingPanel({
	projects,
	currentProjectSlug = null,
	isStarting,
	onProjectClick,
	onCreateRunSubmit,
	onCancelRun,
	onDeleteProject,
}: LandingPanelProps) {
	const [isCreatingRun, setIsCreatingRun] = useState(false)

	return (
		<div className="agent-hud__project-view flex min-h-0 w-full flex-1 flex-col gap-8">
			<fieldset
				disabled={isStarting}
				aria-busy={isStarting}
				className="agent-hud__table-scroll m-0 min-h-0 min-w-0 flex-1 overflow-y-auto border-0 px-2 py-0">
				{projects.length > 0 ? (
					<ProjectsTable
						projects={projects}
						currentProjectSlug={currentProjectSlug}
						onProjectClick={onProjectClick}
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
				{isCreatingRun ? (
					<CreateRunForm
						isCreating={isStarting}
						onCancel={() => setIsCreatingRun(false)}
						onSubmit={onCreateRunSubmit}
					/>
				) : (
					<button
						type="button"
						onClick={() => setIsCreatingRun(true)}
						disabled={isStarting}
						className="app-nav__cta agent-hud__start">
						New Project
					</button>
				)}
			</div>
		</div>
	)
}
