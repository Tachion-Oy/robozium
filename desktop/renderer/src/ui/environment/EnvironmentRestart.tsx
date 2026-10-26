// Copied from robozium-electron/desktop/web/app/components/hud/environment/EnvironmentRestart.tsx at 076b2c9.
// Adapted: the restart flag and the restart action arrive as props, and unsaved
// edits are confirmed in the HUD instead of a native dialog.
import { useState } from "react"
import { showErrorToast } from "../../feedback/notices"
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
	if (confirming) return <div className="flex flex-wrap items-center gap-3">
		<p role="alert">Restart without saving your environment changes? Unsaved changes will be lost.</p>
		<HudButton variant="danger-confirm" onClick={() => void restart()}>Restart</HudButton>
		<HudButton variant="warning" onClick={() => setConfirming(false)}>Keep editing</HudButton>
	</div>
	return <div className="flex items-center gap-3">
		<HudButton pending={restarting} onClick={() => { if (dirty) setConfirming(true); else void restart() }}>
			{restarting ? "Restarting…" : "Restart app"}
		</HudButton>
		{(required || importedPending) && <p role="status">Restart to apply your changes.</p>}
	</div>
}
