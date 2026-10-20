"use client"

import { useState } from "react"
import { useDesktop } from "@/hooks/useDesktop"
import { useStore } from "zustand"
import { desktopRestartStore } from "@/lib/desktop"
import { showErrorToast } from "@/app/components/feedback/ErrorToast"
import { HudButton } from "../HudButton"

export function EnvironmentRestart({ importedPending, dirty }: {
	importedPending: boolean; dirty: boolean
}) {
	const required = useStore(desktopRestartStore, state => state.required)
	const [restarting, setRestarting] = useState(false)
	const desktop = useDesktop()
	if (!desktop) return null
	const restart = async () => {
		if (dirty && !window.confirm("Restart without saving your environment changes? Unsaved changes will be lost.")) return
		setRestarting(true)
		try { await window.robozium!.restartApp() }
		catch (cause) {
			setRestarting(false)
			showErrorToast({ title: "Could not restart app", message: cause instanceof Error ? cause.message : "Restart failed" })
		}
	}
	return <div className="flex items-center gap-3">
		<HudButton disabled={restarting} onClick={() => void restart()}>
			{restarting ? "Restarting…" : "Restart app"}
		</HudButton>
		{(required || importedPending) && <p role="status">Restart to apply your changes.</p>}
	</div>
}
