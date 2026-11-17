import { CapabilityState } from "../../capabilities/capabilities"
import type { CapabilityView } from "../../capabilities/capabilities-api"
import { HudButton } from "./HudButton"

type CapabilityItemProps = {
	capability: Pick<CapabilityView, "name" | "kind">
	selection?: { state: CapabilityState; disabled: boolean; onToggle: () => void }
}

// aria-checked takes "false", "mixed" or "true"; on demand is the standard third state.
function ariaChecked(state: CapabilityState): "false" | "mixed" | "true" {
	if (state === CapabilityState.Off) return "false"
	if (state === CapabilityState.OnDemand) return "mixed"
	return "true"
}

export function CapabilityItem({ capability, selection }: CapabilityItemProps) {
	const name = capability.name.replaceAll("_", " ")
	const content = <>
		<span className="agent-hud__capability-name">{name}</span>
		<span className="agent-hud__capability-badge">{capability.kind === "skill" ? "Skill" : "Tool"}</span>
	</>

	return selection ? (
		<HudButton
			variant="option"
			role="checkbox"
			aria-label={name}
			aria-checked={ariaChecked(selection.state)}
			disabled={selection.disabled}
			onClick={selection.onToggle}
			className="flex items-center gap-3">
			{content}
		</HudButton>
	) : (
		<span className="agent-hud__row-action agent-hud__row-tools agent-hud__capability-static flex items-center gap-2">
			{content}
		</span>
	)
}
