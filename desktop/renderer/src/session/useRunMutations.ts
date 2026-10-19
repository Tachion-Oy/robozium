// Writes to the displayed run, bound to its session scope. The session reads
// and reconciles the run; this hook only sends what the user asked for.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { showErrorToast } from "../feedback/notices"
import { submitReply } from "../run/run-api"
import { RunStatus } from "../run/run-contracts"
import type { RunSessionState } from "./useRunSession"

/** "ignored" means nothing was sent: no answerable prompt, an empty reply or one already in flight. */
export type ReplyResult = "acknowledged" | "failed" | "ignored"

export interface RunMutations {
	canReply: boolean
	replying: boolean
	reply: (content: string) => Promise<ReplyResult>
}

export function useRunMutations(client: DesktopApiClient | null, run: RunSessionState): RunMutations {
	const active = useRef<AbortController | null>(null)
	const [replying, setReplying] = useState(false)
	const { session, scope, acknowledge } = run
	// A new displayed run, retry or client ends the previous run's writes.
	useEffect(() => () => {
		active.current?.abort()
		active.current = null
		setReplying(false)
	}, [scope])

	const prompt = session?.run.prompt ?? null
	const canReply = Boolean(session?.run.synchronized && session.run.status === RunStatus.AwaitingUserInput
		&& prompt && !session.run.error)

	const reply = async (content: string): Promise<ReplyResult> => {
		const trimmed = content.trim()
		if (!client || !session || !prompt || !scope || scope.aborted || !canReply || !trimmed || active.current) return "ignored"
		const controller = new AbortController()
		active.current = controller
		setReplying(true)
		const signal = AbortSignal.any([scope, controller.signal])
		try {
			// Sent once per action; a failure keeps the draft and the next snapshot shows the outcome.
			await withDeadline(signal, requestSignal => submitReply(client, session.run.runId, prompt.id, trimmed, requestSignal))
			acknowledge(prompt.id)
			return "acknowledged"
		} catch (error) {
			if (signal.aborted) return "ignored"
			showErrorToast({
				title: "Reply failed",
				message: "Could not send your reply. Your draft has been kept.",
				detail: error instanceof Error ? error.message : null,
			})
			return "failed"
		} finally {
			if (active.current === controller) {
				active.current = null
				setReplying(false)
			}
		}
	}

	return { canReply, replying, reply }
}
