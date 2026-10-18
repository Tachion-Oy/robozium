// Shared React request state: one operation, cancellation and stale-result rejection.
// Feature hooks own the accepted data and retry decisions; request.ts supplies deadlines.
import { useCallback, useEffect, useRef, useState } from "react"
import { withDeadline } from "./request"

export interface RequestState {
	run: <T>(request: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => Promise<void>
	cancel: () => void
	pending: boolean
	error: string
}

/** One request at a time, with explicit cancellation and no automatic write retries. */
export function useRequest(preserveErrorWhilePending = false): RequestState {
	const activeRequest = useRef<AbortController | null>(null)
	const [pending, setPending] = useState(false)
	const [error, setError] = useState("")
	const cancel = useCallback(() => {
		activeRequest.current?.abort()
		activeRequest.current = null
		setPending(false)
	}, [])
	useEffect(() => cancel, [cancel])
	const run = useCallback(async <T,>(request: (signal: AbortSignal) => Promise<T>, accept: (value: T) => void) => {
		if (activeRequest.current) return
		const controller = new AbortController()
		activeRequest.current = controller
		setPending(true)
		if (!preserveErrorWhilePending) setError("")
		try {
			const value = await withDeadline(controller.signal, request)
			if (activeRequest.current === controller) { setError(""); accept(value) }
		} catch (failure) {
			if (activeRequest.current === controller) setError(failure instanceof Error ? failure.message : "Request failed.")
		} finally {
			if (activeRequest.current === controller) { activeRequest.current = null; setPending(false) }
		}
	}, [preserveErrorWhilePending])
	return { run, cancel, pending, error }
}
