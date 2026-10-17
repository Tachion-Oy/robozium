import { HudButton } from "../hud/HudButton"
import "./run-overview.css"

export function RunOverview({ hasRun, onOpen, connected = false }: { hasRun: boolean; onOpen: () => void; connected?: boolean }) {
	return (
		<section className="run-overview" aria-labelledby="overview-heading">
			<h2 id="overview-heading">{connected ? "Preview run" : "Runs Overview"}</h2>
			<p>{connected ? "Local mock history" : "Mock run"}</p>
			<HudButton variant="success" onClick={onOpen}>
				{hasRun ? "Return to run" : connected ? "Open preview run" : "Start run"}
			</HudButton>
		</section>
	)
}
