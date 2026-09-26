import { getActiveStreamingMessageFromHud } from "./hud-reducer"
import {
	AgentActivityState,
	RunHudPhase,
	type RunSessionState,
} from "./reducer.types"

export { AgentActivityState, RunHudPhase } from "./reducer.types"

export function agentActivityStateForPhase(
	phase: RunHudPhase,
): AgentActivityState {
	return phase === RunHudPhase.Prompting
		? AgentActivityState.AwaitingInput
		: AgentActivityState.Working
}

export type {
	RunSessionState,
	LogState,
	HudState,
	HudMessage,
	HudMessageNavigationDirection,
	RuntimeErrorNotification,
	SessionEvent,
} from "./reducer.types"

export function createInitialRunSessionState(runId: string): RunSessionState {
	return {
		runId,
		projectSlug: null,
		log: {
			items: [],
			minSequence: 0,
		},
		hud: {
			messages: [],
			selectedMessageId: null,
			isMessageHistoryPinned: false,
			streaming: null,
			lastStreaming: null,
			isSettling: false,
			status: null,
			prompt: null,
			promptId: null,
			currentAgentName: null,
			dismissedPromptId: null,
			isCancelling: false,
			isInterrupting: false,
			phase: RunHudPhase.Passive,
		},
		notifications: [],
	}
}

export function getActiveStreamingMessage(state: RunSessionState) {
	return getActiveStreamingMessageFromHud(state.hud)
}

/**
 * Permanent stream-open failures already live in the notification timeline so
 * the toast can render them. Reuse that durable signal for UI recovery instead
 * of introducing a second client-side availability state.
 */
export function hasPermanentRunFailure(state: RunSessionState): boolean {
	return state.notifications.some(
		(notification) =>
			notification.category === "stream" &&
			notification.kind === "open_failed" &&
			notification.agentName === "system",
	)
}

/**
 * A run route has no more live work to display once the root run is terminal
 * or the backend says the run can no longer be opened. Keep this predicate in
 * the session layer so transport teardown and route navigation cannot drift.
 */
export function shouldExitRunView(state: RunSessionState): boolean {
	return (
		state.hud.phase === RunHudPhase.Done || hasPermanentRunFailure(state)
	)
}

export { reduceSessionEvent as reduceRunSessionState } from "./stream-adapter"
