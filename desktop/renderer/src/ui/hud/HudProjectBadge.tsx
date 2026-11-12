import { HudBadge } from "./HudBadge"

export function HudProjectBadge({ name }: { name: string | null }) {
	const label = name || "waiting for project info"
	return (
		<div className="agent-hud__event-edge">
			<HudBadge key={label} title={name ?? undefined}>{label}</HudBadge>
		</div>
	)
}
