// Notices raised by live run updates. One case per signal the HUD announces;
// everything else a run sends is shown by the reducers, never toasted.
import { showErrorToast, showNotificationToast, type NotificationTone } from "../feedback/notices"
import { RunFrameKind, RunStatus, RuntimeLevel, type RunFrame } from "../run/run-contracts"
import type { RunUpdate } from "../run/run-updates"

/** Raise the toast a live update warrants, if any. Replayed history never arrives here as frames. */
export function announceRunUpdate(update: RunUpdate, project: string): void {
	switch (update.type) {
		case "snapshot":
			if (update.view.status === RunStatus.Failed) {
				showErrorToast({ title: "Run failed", message: `Could not run "${project}".`, detail: update.view.error })
			}
			return
		case "frame":
			announceFrame(update.frame)
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
