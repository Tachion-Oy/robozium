"use client"

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	type ReactNode,
} from "react"
import { createStore } from "zustand/vanilla"
import { useStore } from "zustand"
import { createRunSession, type RunSession } from "@/lib/robozium/session"
import type { RunSessionState } from "@/lib/robozium/session/reducer"
import { createInitialRunSessionState } from "@/lib/robozium/session/reducer"
import type { RunView } from "@/lib/robozium/wire"

const RunSessionContext = createContext<RunSession | null>(null)
const EMPTY_SESSION_STORE = createStore<RunSessionState>(() =>
	createInitialRunSessionState("__no-run__"),
)

export function useRunSession(): RunSession | null {
	return useContext(RunSessionContext)
}

type RunSessionProviderProps = {
	runId: string | null
	/** Server-fetched view used to seed the store at session creation. */
	initialRunView?: RunView | null
	children: ReactNode
}

export function RunSessionProvider({
	runId,
	initialRunView = null,
	children,
}: RunSessionProviderProps) {
	// The seed only matters at creation; a live session must not be recreated
	// just because a re-render hands down a fresh seed object.
	const session = useMemo(
		() => (runId ? createRunSession(runId, initialRunView) : null),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[runId],
	)

	useEffect(() => {
		if (!session) return
		session.start()
		return () => {
			session.dispose()
		}
	}, [session])

	return (
		<RunSessionContext.Provider value={session}>
			{children}
		</RunSessionContext.Provider>
	)
}

export function useRunSessionSelector<T>(
	selector: (state: RunSessionState) => T,
	fallback: T,
): T {
	const session = useRunSession()
	const store = session?.store ?? EMPTY_SESSION_STORE
	const selected = useStore(store, (state) => selector(state))
	return session ? selected : fallback
}
