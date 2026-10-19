// Copied from robozium-electron/desktop/web/app/components/hud/HudButton.tsx at 076b2c9.
import type { ComponentPropsWithRef } from "react"

const variants = {
	info: "agent-hud__row-tools",
	success: "agent-hud__row-launch",
	warning: "agent-hud__row-cancel",
	danger: "agent-hud__row-delete",
	"danger-confirm": "agent-hud__row-delete agent-hud__row-delete--confirm",
	option: "agent-hud__option",
} as const

type HudButtonProps = ComponentPropsWithRef<"button"> & {
	variant?: keyof typeof variants
}

export function HudButton({ variant = "info", type = "button", className = "", ...props }: HudButtonProps) {
	return (
		<button
			{...props}
			type={type}
			className={`agent-hud__row-action ${variants[variant]} ${className}`.trim()}
		/>
	)
}
