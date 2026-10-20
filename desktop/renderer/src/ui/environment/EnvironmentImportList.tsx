// Copied from robozium-electron/desktop/web/app/components/hud/environment/EnvironmentImportList.tsx at 076b2c9.
// Adapted: desktop import paths.
import type { EnvironmentImport } from "../../environment/environment-api"
import { CapabilityItem } from "../hud/CapabilityItem"

export function EnvironmentImportList({ imported }: { imported: EnvironmentImport[] }) {
	return (
		<section aria-label="Tools & skills" className="agent-hud__environment-imports flex flex-col gap-3 pt-4">
			<h3 className="agent-hud__capability-group-heading">Tools &amp; skills</h3>
			{imported.length === 0 ? <p className="agent-hud__environment-value">No imports yet.</p> : (
				<ul className="flex flex-wrap gap-3">
					{imported.flatMap(item => item.capabilities.map(capability => (
						<li key={capability.name} className="flex flex-col items-start gap-1">
							<CapabilityItem capability={capability} />
							{!item.active && <span className="agent-hud__environment-value">Available on next start</span>}
						</li>
					)))}
				</ul>
			)}
		</section>
	)
}
