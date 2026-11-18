// The view menu. Its run entry opens a single run itself and lists several in a panel beside the menu.
import { useState } from "react"
import { SelectorDropdown, type SelectorOption } from "./SelectorDropdown"
import type { HudScreen, HudScreenOption } from "../../app/hud-navigation"

type HudScreenSelectorProps = {
	screen: HudScreen
	options: readonly HudScreenOption[]
	/** The session's run, marked among the runs while it is on screen. */
	runId: string | null
	onSelectScreen: (screen: HudScreen) => void
	onOpenRun: (runId: string, project: string) => void
}

export function HudScreenSelector({
	screen,
	options,
	runId,
	onSelectScreen,
	onOpenRun,
}: HudScreenSelectorProps) {
	// The open menu keeps the entries it opened with: a run that starts or ends meanwhile never resizes it.
	const [menu, setMenu] = useState(options)
	const selected = options.find((option) => option.value === screen) ?? options[0]
	const runEntry = menu.find((option) => option.value === "run")
	const runs = runEntry?.runs ?? []

	const menuOptions = menu.map((option): SelectorOption<HudScreen> => {
		if (!option.runs || option.runs.length < 2) return option
		const choices = option.runs.map((run) => ({ value: run.runId, label: run.project }))
		return { ...option, choices }
	})

	const choose = (nextScreen: HudScreen) => {
		if (nextScreen === "run") {
			// A single run's entry opens that run, also one the HUD has not opened yet.
			if (runs.length === 1) onOpenRun(runs[0].runId, runs[0].project)
		} else if (nextScreen !== screen) {
			onSelectScreen(nextScreen)
		}
		return true
	}

	const chooseRun = (chosen: string) => {
		const run = runs.find((candidate) => candidate.runId === chosen)
		if (run) onOpenRun(run.runId, run.project)
	}

	return (
		<SelectorDropdown
			value={screen}
			options={menuOptions}
			triggerLabel={selected.label}
			listboxLabel="HUD view"
			onSelect={choose}
			choice={screen === "run" ? runId : null}
			onSelectChoice={chooseRun}
			onOpen={() => setMenu(options)}
			variant="view"
		/>
	)
}
