// The column's centre is the theme toggle, with the zoom buttons above it and the
// panel divider buttons below. Only the divider buttons follow `disabled`.
import { useZoom } from "../../zoom/useZoom"
import { ThemeToggle } from "../theme/ThemeToggle"
import { HudEdgeButton } from "./HudEdgeButton"

export type LayoutMode = "equal" | "top" | "bottom"
export type LayoutDirection = "up" | "down"

/** Panel-seam order from its lowest position to its highest position. */
export const LAYOUT_MODES: readonly LayoutMode[] = ["top", "equal", "bottom"]

export function moveLayoutMode(
	mode: LayoutMode,
	direction: LayoutDirection,
): LayoutMode {
	const index = LAYOUT_MODES.indexOf(mode)
	const offset = direction === "up" ? 1 : -1
	const nextIndex = Math.min(
		LAYOUT_MODES.length - 1,
		Math.max(0, index + offset),
	)
	return LAYOUT_MODES[nextIndex]
}

export type HudLayoutControls = {
	mode: LayoutMode
	onMove: (direction: LayoutDirection) => void
}

export function HudCornerControls({
	layout,
	disabled = false,
}: {
	layout: HudLayoutControls
	disabled?: boolean
}) {
	const zoom = useZoom()
	return (
		<div className="agent-hud__corner-controls">
			<div className="agent-hud__layout-controls" role="group" aria-label="Zoom">
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__corner-control"
					onClick={() => zoom.step(1)}
					disabled={!zoom.canZoomIn}
					aria-label="Zoom in"
					title="Zoom in">
					<svg className="agent-hud__layout-wedge agent-hud__zoom-glyph" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M6.75 2h2.5v4.75H14v2.5H9.25V14h-2.5V9.25H2v-2.5h4.75Z" />
					</svg>
				</HudEdgeButton>
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__corner-control"
					onClick={() => zoom.step(-1)}
					disabled={!zoom.canZoomOut}
					aria-label="Zoom out"
					title="Zoom out">
					<svg className="agent-hud__layout-wedge agent-hud__zoom-glyph" viewBox="0 0 16 16" aria-hidden="true">
						<path d="M2 6.75h12v2.5H2Z" />
					</svg>
				</HudEdgeButton>
			</div>
			<ThemeToggle />
			<div
				className="agent-hud__layout-controls"
				data-disabled={disabled || undefined}
				role="group"
				aria-label={`Panel divider: ${layout.mode}`}>
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__corner-control"
					onClick={() => layout.onMove("up")}
					disabled={disabled || layout.mode === "bottom"}
					aria-label="Move panel divider up">
					<svg
						className="agent-hud__layout-wedge agent-hud__layout-wedge--up"
						viewBox="0 0 16 14"
						aria-hidden="true">
						<path d="M8 1.25 14.75 12.75H1.25Z" />
					</svg>
				</HudEdgeButton>
				<HudEdgeButton
					variant="arrow"
					className="agent-hud__corner-control"
					onClick={() => layout.onMove("down")}
					disabled={disabled || layout.mode === "top"}
					aria-label="Move panel divider down">
					<svg
						className="agent-hud__layout-wedge agent-hud__layout-wedge--down"
						viewBox="0 0 16 14"
						aria-hidden="true">
						<path d="M8 1.25 14.75 12.75H1.25Z" />
					</svg>
				</HudEdgeButton>
			</div>
		</div>
	)
}
