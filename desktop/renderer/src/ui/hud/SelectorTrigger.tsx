// The reference header trigger, written out in SelectorDropdown.tsx and
// UnlockApiKeys.tsx at 076b2c9: a label and a caret that turns while open.
import type { ComponentPropsWithRef, ReactNode } from "react"

type SelectorTriggerProps = Omit<ComponentPropsWithRef<"button">, "children" | "aria-expanded"> & {
	label: ReactNode
	open: boolean
}

export function SelectorTrigger({ label, open, type = "button", className = "", ...props }: SelectorTriggerProps) {
	return (
		<button
			{...props}
			type={type}
			className={`agent-hud__selector-trigger agent-hud__model-trigger ${className}`.trim()}
			aria-expanded={open}>
			<span>{label}</span>
			<svg
				className="agent-hud__model-caret"
				data-open={open || undefined}
				viewBox="0 0 16 14"
				aria-hidden="true">
				<path d="M8 12.75 1.25 1.25h13.5Z" />
			</svg>
		</button>
	)
}
