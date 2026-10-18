import type { RunState } from "../../run/run-reducer"
import { HudButton } from "../HudButton"

interface RunFeedbackProps {
	run: RunState
	status: string
	actionError: string
	projectError: string
	canRetry: boolean
	onRetry: () => void
	onOpenProjects: () => void
}

export function RunFeedback({ run, status, actionError, projectError, canRetry, onRetry, onOpenProjects }: RunFeedbackProps) {
	return (
		<div className="run-feedback">
			<p role="status" aria-label="Run status">{run.project} · {status}</p>
			{run.error && <p role="alert">{run.error}</p>}
			{projectError && <p role="alert">{projectError}</p>}
			{actionError && <p role="alert">{actionError}</p>}
			{run.unavailable && <>
				<p>The previous run is unavailable. Your draft is retained. Open Runs Overview to launch explicitly.</p>
				<HudButton onClick={onOpenProjects}>Open Runs Overview</HudButton>
			</>}
			{run.error && !run.unavailable &&
				<HudButton onClick={onRetry} disabled={!canRetry}>Retry output</HudButton>}
		</div>
	)
}
