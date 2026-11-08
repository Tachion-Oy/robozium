// Notices raised by live run updates. One case per signal the HUD announces;
// everything else a run sends is shown by the reducers, never toasted.
import { showErrorToast, showNotificationToast, type NotificationTone } from "../feedback/notices"
import type { RunAction } from "../run/run-reducer"
import { RunFrameKind, RunStatus, RuntimeLevel, type RunFrame } from "../run/run-contracts"

/** Raise the toast a live update warrants, if any. Replayed history never arrives here as frames. */
export function announceRunUpdate(action: RunAction, project: string): void {
	switch (action.type) {
		case "snapshot":
			if (action.view.status === RunStatus.Failed) {
				showErrorToast({ title: "Run failed", message: `Could not run "${project}".`, detail: action.view.error })
			}
			return
		case "frame":
			announceFrame(action.frame)
			return
		default:
			return
	}
}

function announceFrame(frame: RunFrame): void {
	switch (frame.type) {
		case RunFrameKind.RuntimeNotice:
			showNotificationToast({
				tone: toneOf(frame.level),
				title: frame.level === RuntimeLevel.Error ? "Runtime error" : "Runtime notice",
				message: frame.message,
			})
			return
		default:
			return
	}
}

function toneOf(level: RuntimeLevel): NotificationTone {
	switch (level) {
		case RuntimeLevel.Error: return "error"
		case RuntimeLevel.Warning: return "warning"
		default: return "info"
	}
}
