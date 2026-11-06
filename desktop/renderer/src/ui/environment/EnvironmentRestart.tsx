// The restart flag and the restart action arrive as props. Every click answers at once:
// unsaved edits are refused with a toast that says so, and the restart reminder is a
// toast too, so the button never moves and keeps no state of its own.
import { useState } from "react"
import { showErrorToast, showNotificationToast } from "../../feedback/notices"
import { Toast } from "../feedback/Toast"
import { HudButton } from "../hud/HudButton"

export function EnvironmentRestart({ required, dirty, onRestart }: {
	required: boolean; dirty: boolean; onRestart: () => Promise<void>
}) {
	const [restarting, setRestarting] = useState(false)
	const restart = async () => {
		if (dirty) {
			showNotificationToast({ tone: "warning", title: "Unsaved changes", message: "Save or undo your changes before restarting." })
			return
		}
		setRestarting(true)
		try { await onRestart() }
		catch (cause) {
			setRestarting(false)
			showErrorToast({ title: "Could not restart app", message: cause instanceof Error ? cause.message : "Restart failed" })
		}
	}
	return <>
		<HudButton variant="warning" pending={restarting} onClick={() => void restart()}>
			{restarting ? "Restarting…" : "Restart app"}
		</HudButton>
		{required && !restarting && <Toast tone="info" title="Restart required" message="Restart to apply your changes." />}
	</>
}
