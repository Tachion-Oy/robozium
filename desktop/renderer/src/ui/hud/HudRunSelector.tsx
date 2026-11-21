// The run selector names the displayed run where the header row starts and lists every
// live run, so another opens without the overview. The message log's names the run the
// log shows, in its bottom row. One live run or none gets a line saying more are
// launched from the overview.
import { isActiveRunStatus, type ProjectRow } from "../../projects/project-rows"
import { SelectorDropdown, type SelectorOption } from "./SelectorDropdown"

type HudRunSelectorProps = {
	/** The displayed run; its project is null until it is known. */
	runId: string | null
	project: string | null
	rows: readonly ProjectRow[]
	disabled: boolean
	onOpenRun: (runId: string, project: string) => void
	variant: "run" | "log"
}

export function HudRunSelector({ runId, project, rows, disabled, onOpenRun, variant }: HudRunSelectorProps) {
	const options: SelectorOption<string>[] = []
	for (const row of rows) {
		if (row.runId !== null && isActiveRunStatus(row.status)) options.push({ value: row.runId, label: row.slug })
	}
	// A run just launched is offered before a listing names it.
	const listed = options.some(option => option.value === runId)
	if (runId !== null && project !== null && !listed) options.unshift({ value: runId, label: project })

	const choose = (nextRunId: string) => {
		const chosen = options.find(option => option.value === nextRunId)
		if (chosen && nextRunId !== runId) onOpenRun(chosen.value, chosen.label)
		return true
	}

	let noteClass = "agent-hud__model-empty"
	if (variant === "log") noteClass = "term-log-selector__note"
	let note = null
	if (options.length <= 1) note = <span className={noteClass}>Launch more from Runs Overview</span>

	// The log's selector also opens without a live run of its own.
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
