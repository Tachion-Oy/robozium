type MessageWedgeProps = {
	direction: "previous" | "next"
	jump?: boolean
}

export function MessageWedge({
	direction,
	jump = false,
}: MessageWedgeProps) {
	if (jump) {
		const paths =
			direction === "previous"
				? [
						"M20.75 1.25 9.25 7 20.75 12.75Z",
						"M14.75 1.25 3.25 7 14.75 12.75Z",
					]
				: [
						"M1.25 1.25 12.75 7 1.25 12.75Z",
						"M7.25 1.25 18.75 7 7.25 12.75Z",
					]

		return (
			<svg
				className={`agent-hud__layout-wedge agent-hud__message-wedge agent-hud__message-wedge--${direction} agent-hud__message-wedge--jump`}
				viewBox="0 0 22 14"
				aria-hidden="true">
				{paths.map((path) => (
					<path
						key={path}
						d={path}
					/>
				))}
			</svg>
		)
	}

	return (
		<svg
			className={`agent-hud__layout-wedge agent-hud__message-wedge agent-hud__message-wedge--${direction}`}
			viewBox="0 0 16 14"
			aria-hidden="true">
			<path d="M8 1.25 14.75 12.75H1.25Z" />
		</svg>
	)
}
