import {
	cancelProject as cancelProjectApi,
	interruptRun as interruptRunApi,
	submitReply as submitReplyApi,
} from "../client"
import { createStore, type StoreApi } from "zustand/vanilla"
import type { RunView } from "../wire"
import { startRunSessionConnection } from "./connection"
import {
	createInitialRunSessionState,
	reduceRunSessionState,
	shouldExitRunView,
	type HudMessageNavigationDirection,
	type RunSessionState,
	type SessionEvent,
} from "./reducer"
import { startRunSessionPoller } from "./poller"

export type RunSession = {
	store: StoreApi<RunSessionState>
	start: () => void
	dispose: () => void
	submitReply: (content: string) => Promise<boolean>
	navigateHudMessage: (direction: HudMessageNavigationDirection) => void
	cancelRun: () => Promise<boolean>
	interruptRun: () => Promise<boolean>
}

export function createRunSession(
	runId: string,
	initialRunView?: RunView | null,
): RunSession {
	// Seed the store from the server-fetched view when available, so the first
	// render already has the log/HUD populated instead of hydrating ~½s later.
	const store = createStore<RunSessionState>(() => {
		const base = createInitialRunSessionState(runId)
		if (!initialRunView) return base
		return reduceRunSessionState(base, {
			class: "runView",
			type: "received",
			runView: initialRunView,
		})
	})

	let started = false
	let stopConnection: (() => void) | null = null
	let stopPoller: (() => void) | null = null

	const stopTransports = () => {
		if (!started) return
		started = false
		stopConnection?.()
		stopPoller?.()
		stopConnection = null
		stopPoller = null
	}

	const dispatch = (event: SessionEvent) => {
		if (shouldExitRunView(store.getState())) return
		store.setState((state) => reduceRunSessionState(state, event))
		// Preserve the final snapshot and stop requests for a finished run.
		if (shouldExitRunView(store.getState())) stopTransports()
	}

	const start = () => {
		if (started || shouldExitRunView(store.getState())) return
		started = true
		// Stream + poller each get the same dispatch pipeline.
		stopConnection = startRunSessionConnection(runId, dispatch)
		stopPoller = startRunSessionPoller(runId, dispatch)
	}

	const dispose = () => stopTransports()

	const submitReply = async (content: string): Promise<boolean> => {
		const hud = store.getState().hud
		const promptId = hud.promptId
		if (!promptId || !content.trim()) return false
		await submitReplyApi(runId, {
			prompt_id: promptId,
			content: content.trim(),
		})
		dispatch({ class: "control", type: "reply_submitted", promptId })
		return true
	}

	const navigateHudMessage = (direction: HudMessageNavigationDirection) => {
		dispatch({ class: "control", type: "hud_message_navigated", direction })
	}

	const cancelRun = async (): Promise<boolean> => {
		dispatch({ class: "control", type: "cancel_requested" })
		const projectSlug = store.getState().projectSlug
		if (!projectSlug) {
			dispatch({ class: "control", type: "cancel_failed" })
			return false
		}
		try {
			const { ok } = await cancelProjectApi(projectSlug)
			if (!ok) {
				dispatch({ class: "control", type: "cancel_failed" })
			}
			return ok
		} catch {
			dispatch({ class: "control", type: "cancel_failed" })
			return false
		}
	}

	const interruptRun = async (): Promise<boolean> => {
		const state = store.getState()
		if (state.hud.isInterrupting || state.hud.isCancelling) return false
		dispatch({ class: "control", type: "interrupt_requested" })
		try {
			const { ok } = await interruptRunApi(runId)
			if (!ok) dispatch({ class: "control", type: "interrupt_failed" })
			return ok
		} catch {
			dispatch({ class: "control", type: "interrupt_failed" })
			return false
		}
	}

	return {
		store,
		start,
		dispose,
		submitReply,
		navigateHudMessage,
		cancelRun,
		interruptRun,
	}
}
