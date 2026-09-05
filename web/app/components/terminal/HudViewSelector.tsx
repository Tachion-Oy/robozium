"use client"

import { SelectorDropdown } from "./SelectorDropdown"
import type { HudView } from "./AgentHudView"

type HudViewSelectorProps = {
	view: HudView
	isLanding: boolean
	isRecovery: boolean
	onSelectView: (view: HudView) => void
}

type HudViewOption = {
	value: HudView
	label: string
}

const activeRunOptions: HudViewOption[] = [
	{ value: "main", label: "Current Run" },
	{ value: "agents", label: "Runs Overview" },
	{ value: "dependencies", label: "Dependencies" },
]

const landingOptions: HudViewOption[] = [
	{ value: "main", label: "Runs Overview" },
	{ value: "dependencies", label: "Dependencies" },
]

const recoveryOptions: HudViewOption[] = [
	{ value: "agents", label: "Runs Overview" },
	{ value: "dependencies", label: "Dependencies" },
]

export function HudViewSelector({
	view,
	isLanding,
	isRecovery,
	onSelectView,
}: HudViewSelectorProps) {
	const options = isRecovery
		? recoveryOptions
		: isLanding
			? landingOptions
			: activeRunOptions
	const selected = options.find((option) => option.value === view) ?? options[0]

	const choose = (nextView: HudView) => {
		if (nextView !== view) onSelectView(nextView)
		return true
	}

	return (
		<SelectorDropdown
			value={view}
			options={options}
			triggerLabel={selected.label}
			listboxLabel="HUD view"
			onSelect={choose}
			variant="view"
		/>
	)
}
