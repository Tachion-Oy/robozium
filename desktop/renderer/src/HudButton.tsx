import type { ComponentPropsWithRef } from "react"

const variants = {
	info: "hud-button--info",
	success: "hud-button--success",
	warning: "hud-button--warning",
	danger: "hud-button--danger",
} as const

type HudButtonProps = ComponentPropsWithRef<"button"> & {
	variant?: keyof typeof variants
}

export function HudButton({ variant = "info", type = "button", className = "", ...props }: HudButtonProps) {
	return (
		<button
			{...props}
			type={type}
			className={`hud-button ${variants[variant]} ${className}`.trim()}
		/>
	)
}
