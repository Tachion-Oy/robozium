type HudProjectBadgeProps = {
	projectSlug: string | null
}

export function HudProjectBadge({
	projectSlug,
}: HudProjectBadgeProps) {
	const label = projectSlug || "waiting for project info"

	return (
		<div className="agent-hud__event-edge">
			<span className="agent-hud__event-label">
				<span className="term-msg-badge">
					<span className="term-msg-badge-label">
						<span
							key={label}
							title={projectSlug ?? undefined}
							className="agent-hud__event-text">
							{label}
						</span>
					</span>
				</span>
			</span>
		</div>
	)
}
