"use client"

import { useState } from "react"
import { useDesktop } from "@/hooks/useDesktop"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { HudButton } from "../hud/HudButton"

export function BackendControls() {
	const desktop = useDesktop()
	const [busy, setBusy] = useState(false)
	if (!desktop) return null
	const manage = async (operation: "restart" | "recreate") => {
		setBusy(true)
		try { await (operation === "restart" ? window.robozium!.restartBackend() : window.robozium!.recreateBackend()) }
		catch (cause) { showErrorToast({ title: "Backend operation failed", message: cause instanceof Error ? cause.message : "Operation failed" }) }
		finally { setBusy(false) }
	}
	return <div className="flex gap-3" aria-label="Backend controls">
		<HudButton disabled={busy} onClick={() => void manage("restart")}>Restart backend</HudButton>
		<HudButton disabled={busy} onClick={() => void manage("recreate")}>Recreate backend</HudButton>
	</div>
}
