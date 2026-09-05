"use client"

import { SelectorDropdown } from "./SelectorDropdown"
import type {
	HudScreen,
	HudScreenOption,
} from "./hudPresentation"

type HudScreenSelectorProps = {
	screen: HudScreen
	options: readonly HudScreenOption[]
	onSelectScreen: (screen: HudScreen) => void
}

export function HudScreenSelector({
	screen,
	options,
	onSelectScreen,
}: HudScreenSelectorProps) {
	const selected = options.find((option) => option.value === screen) ?? options[0]

	const choose = (nextScreen: HudScreen) => {
		if (nextScreen !== screen) onSelectScreen(nextScreen)
		return true
	}

	return (
		<SelectorDropdown
			value={screen}
			options={options}
			triggerLabel={selected.label}
			listboxLabel="HUD view"
			onSelect={choose}
			variant="view"
		/>
	)
}
