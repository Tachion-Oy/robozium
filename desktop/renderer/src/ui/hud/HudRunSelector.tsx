// The run selector lists every live run, so another opens without the overview. The
// header's names the displayed run where the header row starts; the message log's, in
// its bottom row, names the run the log shows. One live run gets a line saying more are
// launched from the overview.
import type { LiveRun } from "../../projects/project-rows"
import { SelectorDropdown, type SelectorOption } from "./SelectorDropdown"

type HudRunSelectorProps = {
	/** The shown run; its project is null until it is known. */
	runId: string | null
	project: string | null
	runs: readonly LiveRun[]
	disabled: boolean
	onOpenRun: (runId: string, project: string) => void
	variant: "run" | "log"
}

export function HudRunSelector({ runId, project, runs, disabled, onOpenRun, variant }: HudRunSelectorProps) {
	const options: SelectorOption<string>[] = runs.map(run => ({ value: run.runId, label: run.project }))

	const choose = (nextRunId: string) => {
		const chosen = options.find(option => option.value === nextRunId)
		if (chosen && nextRunId !== runId) onOpenRun(chosen.value, chosen.label)
		return true
	}

	let noteClass = "agent-hud__model-empty"
	if (variant === "log") noteClass = "term-log-selector__note"
	let note = null
	if (options.length === 1) note = <span className={noteClass}>Launch more from Runs Overview</span>

	// The log's selector also stands without a live run of its own, offering the others.
	let triggerLabel = project ?? "waiting for project info"
	let listboxLabel = "Live runs"
	let waiting = project === null
	if (variant === "log") {
		triggerLabel = project ?? "Live runs"
		listboxLabel = "Log runs"
		waiting = false
	}

	return (
		<SelectorDropdown
			value={runId}
			options={options}
			triggerLabel={triggerLabel}
			listboxLabel={listboxLabel}
			onSelect={choose}
			disabled={disabled || waiting}
			variant={variant}
			note={note}
		/>
	)
}
