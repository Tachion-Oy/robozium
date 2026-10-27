// Copied from robozium-electron/desktop/web/app/components/hud/HudCornerControls.tsx at 076b2c9.
// Adapted: the theme toggle heads the column, above the panel divider buttons; no Minimize.
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
	return (
		<div
			className="agent-hud__corner-controls"
			data-disabled={disabled || undefined}>
			<ThemeToggle />
			<div
				className="agent-hud__layout-controls"
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
