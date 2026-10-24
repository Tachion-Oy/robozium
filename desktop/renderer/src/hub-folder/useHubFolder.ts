// Own the hub folder choice: main picks with the native dialog, checks the folder
// and records it; this hook holds the confirmation and the outcome for the HUD.
import { useEffect, useRef, useState } from "react"
import type { HubFolderStatus } from "../../../src/bridge"
import { bridgeErrorMessage } from "../feedback/bridge-error"
import { showNotificationToast } from "../feedback/notices"

export interface HubFolder {
	status: HubFolderStatus | null
	/** A picked folder that has files but no hub in it, awaiting confirmation. */
	picked: string | null
	pending: boolean
	error: string
	choose: () => Promise<void>
	confirm: () => Promise<void>
	cancel: () => void
	open: () => Promise<void>
}

/** A newly recorded folder applies only after the app restarts. */
export function hubRestartNeeded({ status }: HubFolder): boolean {
	return status !== null && status.selected !== null && status.current !== null && status.selected !== status.current
}

export function hubFolderConfirmation(folder: string): string {
	return `${folder} already has files but no Robozium projects. Use it as the hub folder anyway?`
}

/** `onUsed` runs after a new folder is recorded, for example to retry a startup that lacked one. */
export function useHubFolder(onUsed?: () => void): HubFolder {
	const [status, setStatus] = useState<HubFolderStatus | null>(null)
	const [picked, setPicked] = useState<string | null>(null)
	const [pending, setPending] = useState(false)
	// Two clicks in one frame both see the rendered state; the ref keeps a second dialog from opening.
	const running = useRef(false)
	const [error, setError] = useState("")

	useEffect(() => {
		let active = true
		const load = async () => {
			try {
				const next = await window.robozium.getHubFolder()
				if (active) setStatus(next)
			} catch (cause) {
				if (active) setError(bridgeErrorMessage(cause) ?? "Could not read the hub folder.")
			}
		}
		void load()
		return () => { active = false }
	}, [])

	const run = async (operation: () => Promise<void>) => {
		if (running.current) return
		running.current = true
		setPending(true)
		setError("")
		try {
			await operation()
		} catch (cause) {
			setError(bridgeErrorMessage(cause) ?? "The hub folder could not be changed.")
		} finally {
			running.current = false
			setPending(false)
		}
	}
	const use = async () => {
		const next = await window.robozium.useHubFolder()
		setStatus(next)
		setPicked(null)
		// At startup the backend is not running yet, so the folder applies on the retry itself.
		if (onUsed) onUsed()
		else showNotificationToast({ tone: "success", title: "Hub folder chosen", message: `${next.selected} takes effect after restart.` })
	}
	return {
		status, picked, pending, error,
		choose: () => run(async () => {
			setPicked(null)
			const pick = await window.robozium.chooseHubFolder()
			if (pick?.needsConfirmation) setPicked(pick.folder)
			else if (pick) await use()
		}),
		confirm: () => run(use),
		cancel: () => setPicked(null),
		open: () => run(() => window.robozium.openHubFolder()),
	}
}
