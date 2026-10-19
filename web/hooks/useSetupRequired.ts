"use client"

import { useEffect, useState } from "react"
import { getCredentialStatus } from "@/lib/robozium/client"

/**
 * Whether the API started in live mode without `.env` or `.env.encrypt`.
 * The server seed avoids a flash of the unlocked HUD; the client read keeps
 * the page current when it was restored from the browser cache.
 */
export function useSetupRequired(initial: boolean): boolean {
	const [setupRequired, setSetupRequired] = useState(initial)

	useEffect(() => {
		const controller = new AbortController()
		const refresh = async () => {
			try {
				const status = await getCredentialStatus({ signal: controller.signal })
				if (!controller.signal.aborted) setSetupRequired(status.setup_required)
			} catch {}
		}
		void refresh()
		return () => controller.abort()
	}, [])

	return setupRequired
}
