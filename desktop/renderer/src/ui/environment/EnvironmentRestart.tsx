// Copied from robozium-electron/desktop/web/app/components/hud/environment/EnvironmentRestart.tsx at 076b2c9.
// Adapted: the restart flag and the restart action arrive as props; unsaved edits are
// confirmed, and the restart reminder shown, in toasts, so the button never moves.
import { useState } from "react"
import { showErrorToast, usePersistentToast } from "../../feedback/notices"
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
	usePersistentToast("environment-restart-confirm", confirming ? {
		tone: "warning",
		title: "Unsaved changes",
		message: "Restart without saving your environment changes? Unsaved changes will be lost.",
		actions: [
			{ label: "Restart", onClick: () => void restart() },
			{ label: "Keep editing", onClick: () => setConfirming(false) },
		],
	} : null)
	usePersistentToast("environment-restart", (required || importedPending) && !confirming && !restarting
		? { tone: "info", title: "Restart required", message: "Restart to apply your changes." }
		: null)
	return <HudButton pending={restarting} disabled={confirming} onClick={() => { if (dirty) setConfirming(true); else void restart() }}>
		{restarting ? "Restarting…" : "Restart app"}
	</HudButton>
}
