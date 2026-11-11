// The run's name, top left, with a button that opens the project's folder in the file manager.
import { openProjectFolder } from "../../links/open-link"
import { HudBadge } from "./HudBadge"
import { HudEdgeButton } from "./HudEdgeButton"

export function HudProjectBadge({ projectSlug }: { projectSlug: string | null }) {
	const label = projectSlug || "waiting for project info"
	return (
		<div className="agent-hud__event-edge">
			<HudBadge key={label} title={projectSlug ?? undefined}>{label}</HudBadge>
			<HudEdgeButton
				variant="icon"
				className="agent-hud__project-folder"
				disabled={!projectSlug}
				onClick={() => { if (projectSlug) openProjectFolder(projectSlug) }}
				aria-label="Open project folder"
				title="Open project folder">
				<svg className="agent-hud__copy-text-icon" viewBox="0 0 24 24" aria-hidden="true">
					<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.25l2 2.5h8.75A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
					<path d="M3 11h18" />
				</svg>
			</HudEdgeButton>
		</div>
	)
}
