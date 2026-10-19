import type { CapabilityView } from "@/lib/robozium/wire"
import { HudButton } from "./HudButton"

type CapabilityItemProps = {
	capability: Pick<CapabilityView, "name" | "kind">
	selection?: { checked: boolean; disabled: boolean; onToggle: () => void }
}

export function CapabilityItem({ capability, selection }: CapabilityItemProps) {
	const name = capability.name.replaceAll("_", " ")
	const content = <>
		<span className="agent-hud__capability-name">{name}</span>
		{capability.kind === "skill" && <span className="agent-hud__capability-badge">Skill</span>}
	</>

	return selection ? (
		<HudButton
			variant="option"
			role="checkbox"
			aria-label={name}
			aria-checked={selection.checked}
			disabled={selection.disabled}
			onClick={selection.onToggle}
			className="flex items-center gap-3">
			{content}
		</HudButton>
	) : (
		<span className="agent-hud__row-action agent-hud__option agent-hud__capability-static flex items-center gap-3">
			{content}
		</span>
	)
}
