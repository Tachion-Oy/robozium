import { HudButton } from "../HudButton"
import "./run-overview.css"

export function RunOverview({ hasRun, onOpen, onStart, connected = false, disabled, creating, error, project, existing = false }: {
	hasRun: boolean; onOpen: () => void; onStart: () => void; connected?: boolean
	disabled?: boolean; creating?: boolean; error?: string; project?: string; existing?: boolean
}) {
	return (
		<section className="run-overview" aria-labelledby="overview-heading">
			<h2 id="overview-heading">{connected ? existing ? "Open run" : "Start run" : "Runs Overview"}</h2>
			<p>{connected ? project ? `Project: ${project}` : "Select a project and model to start." : "Mock run"}</p>
			{(!hasRun || connected) && <HudButton variant="success" aria-disabled={disabled}
					onClick={() => { if (!disabled) onStart() }}>{creating ? "Starting run…" : existing ? "Open run" : "Start run"}</HudButton>}
			{hasRun && <HudButton variant="success" onClick={onOpen}>Return to run</HudButton>}
			{error && <p role="alert">Could not start run: {error} Creation is never retried automatically.</p>}
		</section>
	)
}
