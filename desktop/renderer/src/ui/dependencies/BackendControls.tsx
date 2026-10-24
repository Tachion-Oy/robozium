// Copied from robozium-electron/desktop/web/app/components/desktop/BackendControls.tsx at 076b2c9.
// Adapted: the operation comes from the backend owner, which covers it with the
// startup screen and restarts readiness polling afterwards.
import { useState } from "react"
import { showErrorToast } from "../../feedback/notices"
import { HudButton } from "../hud/HudButton"

export function BackendControls({ onManage }: { onManage: (operation: "restart" | "recreate") => Promise<void> }) {
	const [busy, setBusy] = useState(false)
	const manage = async (operation: "restart" | "recreate") => {
		setBusy(true)
		try { await onManage(operation) }
		catch (cause) { showErrorToast({ title: "Backend operation failed", message: cause instanceof Error ? cause.message : "Operation failed" }) }
		finally { setBusy(false) }
	}
	return <div className="flex gap-3" aria-label="Backend controls">
		<HudButton disabled={busy} onClick={() => void manage("restart")}>Restart backend</HudButton>
		<HudButton disabled={busy} onClick={() => void manage("recreate")}>Recreate backend</HudButton>
	</div>
}
