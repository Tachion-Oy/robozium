// The run selector names the displayed run where the header row starts and lists every
// live run, so another opens without the overview. One live run gets a line saying more
// are launched from the overview.
import { isActiveRunStatus, type ProjectRow } from "../../projects/project-rows"
import { SelectorDropdown, type SelectorOption } from "./SelectorDropdown"

type HudRunSelectorProps = {
	/** The displayed run; its project is null until it is known. */
	runId: string | null
	project: string | null
	rows: readonly ProjectRow[]
	disabled: boolean
	onOpenRun: (runId: string, project: string) => void
}

export function HudRunSelector({ runId, project, rows, disabled, onOpenRun }: HudRunSelectorProps) {
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

	let note = null
	if (options.length === 1) note = <span className="agent-hud__model-empty">Launch more from Runs Overview</span>

	return (
		<SelectorDropdown
			value={runId}
			options={options}
			triggerLabel={project ?? "waiting for project info"}
			listboxLabel="Live runs"
			onSelect={choose}
			disabled={disabled || project === null}
			variant="run"
			note={note}
		/>
	)
}
