import { HudButton } from "../hud/HudButton"
import "./run-overview.css"

export function RunOverview({ hasRun, onOpen }: { hasRun: boolean; onOpen: () => void }) {
	return (
		<section className="run-overview" aria-labelledby="overview-heading">
			<h2 id="overview-heading">Runs Overview</h2>
			<p>Mock run</p>
			<HudButton variant="success" onClick={onOpen}>
				{hasRun ? "Return to run" : "Start run"}
			</HudButton>
		</section>
	)
}
