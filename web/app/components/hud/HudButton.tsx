import type { ComponentPropsWithRef } from "react"

const compactVariants = {
	info: "agent-hud__row-tools",
	success: "agent-hud__row-launch",
	warning: "agent-hud__row-cancel",
	danger: "agent-hud__row-delete",
	"danger-confirm": "agent-hud__row-delete agent-hud__row-delete--confirm",
	option: "agent-hud__option",
} as const

type HudButtonProps = ComponentPropsWithRef<"button"> & (
	| { appearance?: "compact"; variant?: keyof typeof compactVariants; primary?: never }
	| { appearance: "control"; variant?: "info" | "success" | "warning" | "danger"; primary?: boolean }
)

/** Shared native button; callers supply only intent, sizing, and behavior. */
export function HudButton({
	variant = "info",
	appearance = "compact",
	primary = false,
	type = "button",
	className = "",
	...props
}: HudButtonProps) {
	const presentation = appearance === "control"
		? `agent-hud__button agent-hud__button--${variant}${primary ? " agent-hud__button--primary" : ""}`
		: `agent-hud__row-action ${compactVariants[variant]}`

	return (
		<button
			{...props}
			type={type}
			className={`${presentation} ${className}`.trim()}
		/>
	)
}
