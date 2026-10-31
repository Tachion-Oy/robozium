// The restart flag and the restart action arrive as props; unsaved edits are
// confirmed, and the restart reminder shown, in toasts, so the button never moves.
import { useState } from "react"
import { showErrorToast } from "../../feedback/notices"
import { Toast } from "../feedback/Toast"
import { HudButton } from "../hud/HudButton"

export function EnvironmentRestart({ required, importedPending, dirty, onRestart }: {
	required: boolean; importedPending: boolean; dirty: boolean; onRestart: () => Promise<void>
}) {
	const [restarting, setRestarting] = useState(false)
	const [confirming, setConfirming] = useState(false)
	const restart = async () => {
		setConfirming(false)
		setRestarting(true)
		try { await onRestart() }
		catch (cause) {
			setRestarting(false)
			showErrorToast({ title: "Could not restart app", message: cause instanceof Error ? cause.message : "Restart failed" })
		}
	}
	const reminder = (required || importedPending) && !confirming && !restarting
	return <>
		<HudButton variant="warning" pending={restarting} disabled={confirming} onClick={() => { if (dirty) setConfirming(true); else void restart() }}>
			{restarting ? "Restarting…" : "Restart app"}
		</HudButton>
		{confirming && <Toast tone="warning" title="Unsaved changes"
			message="Restart without saving your environment changes? Unsaved changes will be lost." actions={[
				{ label: "Restart", onClick: restart },
				{ label: "Keep editing", onClick: () => setConfirming(false) },
			]} />}
		{reminder && <Toast tone="info" title="Restart required" message="Restart to apply your changes." />}
	</>
}
