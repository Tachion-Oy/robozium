// A lifetime for requests that should end with the current client.
import { useCallback, useEffect, useRef } from "react"

/** Returns the current client's signal; a new client or unmount aborts the previous one. */
export function useClientLifetime(client: unknown): () => AbortSignal {
	const lifetime = useRef(new AbortController())
	useEffect(() => {
		lifetime.current = new AbortController()
		return () => lifetime.current.abort()
	}, [client])
	return useCallback(() => lifetime.current.signal, [])
}
