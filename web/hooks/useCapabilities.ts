"use client"

import { useEffect, useState } from "react"
import { listCapabilities } from "@/lib/robozium/client"
import type { CapabilityView } from "@/lib/robozium/wire"

export function useCapabilities() {
	const [catalog, setCatalog] = useState<CapabilityView[] | null>(null)
	const [error, setError] = useState(false)
	const [attempt, setAttempt] = useState(0)
	useEffect(() => {
		const controller = new AbortController()
		void listCapabilities({ signal: controller.signal }).then(
			(value) => {
				if (!controller.signal.aborted) setCatalog(value)
			},
			() => {
				if (!controller.signal.aborted) setError(true)
			},
		)
		return () => controller.abort()
	}, [attempt])
	return {
		catalog,
		error,
		retry: () => {
			setError(false)
			setAttempt((value) => value + 1)
		},
	}
}
