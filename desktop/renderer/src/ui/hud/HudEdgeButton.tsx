// Shared visual primitive for the small square buttons on the HUD edges and beside the
// message mark. Feature components supply the icon, label, action and disabled behavior.
import type { ComponentPropsWithRef } from "react"

const variants = {
	/** A toggle heading an edge column: the message log and the theme. */
	toggle: "agent-hud__corner-control agent-hud__edge-toggle",
	/** An icon action in the right edge column: copy and clear. */
	icon: "agent-hud__copy-text",
	/** A wedge: the panel divider and message navigation arrows. */
	arrow: "agent-hud__layout-direction",
} as const

type HudEdgeButtonProps = ComponentPropsWithRef<"button"> & {
	variant: keyof typeof variants
}

export function HudEdgeButton({ variant, type = "button", className = "", ...props }: HudEdgeButtonProps) {
	return (
		<button
			{...props}
			type={type}
			className={`${variants[variant]} ${className}`.trim()}
		/>
	)
}
