import { HudButton } from "../HudButton"
import "./run-overview.css"

export function RunOverview({ hasRun, onOpen, onStart, connected = false, disabled, creating, project }: {
	hasRun: boolean; onOpen: () => void; onStart: () => void; connected?: boolean
	disabled?: boolean; creating?: boolean; project?: string
}) {
	return (
		<section className="run-overview" aria-labelledby="overview-heading">
			<h2 id="overview-heading">{connected ? "Start run" : "Runs Overview"}</h2>
			<p>{connected ? project ? `Project: ${project}` : "Select a project and model to start." : "Mock run"}</p>
			{(!hasRun || connected) && <HudButton variant="success" aria-disabled={disabled}
				onClick={() => { if (!disabled) onStart() }}>{creating ? "Starting run…" : "Start run"}</HudButton>}
			{hasRun && <HudButton variant="success" onClick={onOpen}>Return to run</HudButton>}
		</section>
	)
}
