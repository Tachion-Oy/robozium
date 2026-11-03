import { HudBadge } from "./HudBadge"

export function HudProjectBadge({ projectSlug }: { projectSlug: string | null }) {
	const label = projectSlug || "waiting for project info"
	return (
		<div className="agent-hud__event-edge">
			<HudBadge key={label} title={projectSlug ?? undefined}>{label}</HudBadge>
		</div>
	)
}
