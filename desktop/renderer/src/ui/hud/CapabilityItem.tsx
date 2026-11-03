import type { CapabilityView } from "../../capabilities/capabilities-api"
import { HudButton } from "./HudButton"

type CapabilityItemProps = {
	capability: Pick<CapabilityView, "name" | "kind">
	selection: { checked: boolean; disabled: boolean; onToggle: () => void }
}

export function CapabilityItem({ capability, selection }: CapabilityItemProps) {
	const name = capability.name.replaceAll("_", " ")
	return (
		<HudButton
			variant="option"
			role="checkbox"
			aria-label={name}
			aria-checked={selection.checked}
			disabled={selection.disabled}
			onClick={selection.onToggle}
			className="flex items-center gap-3">
			<span className="agent-hud__capability-name">{name}</span>
			{capability.kind === "skill" && <span className="agent-hud__capability-badge">Skill</span>}
		</HudButton>
	)
}
