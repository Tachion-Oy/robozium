// Copied from robozium-electron/desktop/web/app/components/desktop/BackendControls.tsx at 076b2c9.
// Adapted: the renderer always has the desktop bridge, and readiness polling restarts
// after an operation, since it stops while the backend is down.
import { useState } from "react"
import { showErrorToast } from "../../feedback/notices"
import { HudButton } from "../hud/HudButton"

export function BackendControls({ onReconnect }: { onReconnect: () => void }) {
	const [busy, setBusy] = useState(false)
	const manage = async (operation: "restart" | "recreate") => {
		setBusy(true)
		try { await (operation === "restart" ? window.robozium.restartBackend() : window.robozium.recreateBackend()) }
		catch (cause) { showErrorToast({ title: "Backend operation failed", message: cause instanceof Error ? cause.message : "Operation failed" }) }
		finally { setBusy(false); onReconnect() }
	}
	return <div className="flex gap-3" aria-label="Backend controls">
		<HudButton disabled={busy} onClick={() => void manage("restart")}>Restart backend</HudButton>
		<HudButton disabled={busy} onClick={() => void manage("recreate")}>Recreate backend</HudButton>
	</div>
}
