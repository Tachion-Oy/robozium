// Writes to the displayed run, bound to its session scope. The session reads
// and reconciles the run; this hook only sends what the user asked for.
import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { showErrorToast } from "../feedback/notices"
import { isSecretsLocked, showSecretsLocked } from "../credentials/locked"
import { interruptRun, submitReply } from "../run/run-api"
import { RunStatus } from "../run/run-contracts"
import type { RunSessionState } from "./useRunSession"

/** "ignored" means nothing was sent: no answerable prompt, an empty reply or one already in flight. */
export type ReplyResult = "acknowledged" | "failed" | "ignored"

/** The reply's staged images; their queue orders the send after its uploads and settles them. */
export interface ReplyImages {
	images: readonly unknown[]
	submit: (send: (hasImages: boolean) => Promise<boolean>) => Promise<boolean>
}

export interface RunMutations {
	canReply: boolean
	replying: boolean
	reply: (content: string, images?: ReplyImages) => Promise<ReplyResult>
	canInterrupt: boolean
	/** From the request until a snapshot shows a prompt or the run no longer running. */
	interrupting: boolean
	interrupt: () => Promise<void>
}

export function useRunMutations(client: DesktopApiClient, run: RunSessionState, onSecretsLocked: () => void): RunMutations {
	const active = useRef<AbortController | null>(null)
	const interruption = useRef<AbortController | null>(null)
	const [replying, setReplying] = useState(false)
	const [interrupting, setInterrupting] = useState(false)
	const { session, scope, acknowledge } = run
	// A new displayed run, retry or client ends the previous run's writes.
	useEffect(() => () => {
		active.current?.abort()
		active.current = null
		interruption.current?.abort()
		interruption.current = null
		setReplying(false)
		setInterrupting(false)
	}, [scope])

	const prompt = session?.run.prompt ?? null
	const synchronized = Boolean(session?.run.synchronized && !session.run.error)
	const running = session?.run.status === RunStatus.Running
	const canReply = Boolean(synchronized && session?.run.status === RunStatus.AwaitingUserInput && prompt)
	const canInterrupt = synchronized && running && !prompt && !interrupting
	// The interruption has taken effect once the agent asks or stops.
	useEffect(() => {
		if (synchronized && (prompt || !running)) setInterrupting(false)
	}, [synchronized, prompt, running])

	const reply = async (content: string, images?: ReplyImages): Promise<ReplyResult> => {
		const trimmed = content.trim()
		const hasContent = Boolean(trimmed || images?.images.length)
		if (!session || !prompt || !scope || scope.aborted || !canReply || !hasContent || active.current) return "ignored"
		const controller = new AbortController()
		active.current = controller
		setReplying(true)
		const signal = AbortSignal.any([scope, controller.signal])
		try {
			// Sent once per action; a failure keeps the draft and the next snapshot shows the outcome.
			const send = async () => {
				await withDeadline(signal, requestSignal => submitReply(client, session.run.runId, prompt.id, trimmed, requestSignal))
				return true
			}
			// The backend attaches the run's staged images to the reply itself.
			if (!await (images ? images.submit(send) : send())) return "ignored"
			acknowledge(prompt.id)
			return "acknowledged"
		} catch (error) {
			if (signal.aborted) return "ignored"
			if (isSecretsLocked(error)) {
				showSecretsLocked("Unlock secrets before replying. Your draft has been kept.")
				onSecretsLocked()
				return "failed"
			}
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

	const interrupt = async (): Promise<void> => {
		if (!session || !scope || scope.aborted || !canInterrupt || interruption.current) return
		const controller = new AbortController()
		interruption.current = controller
		setInterrupting(true)
		const signal = AbortSignal.any([scope, controller.signal])
		let accepted = false
		try {
			// Never repeated; an accepted interruption stays pending until a snapshot shows its effect.
			accepted = await withDeadline(signal, requestSignal => interruptRun(client, session.run.runId, requestSignal))
			if (!accepted) {
				showErrorToast({ title: "Interrupt failed", message: "Could not interrupt this run.", detail: "The backend refused the interruption." })
			}
		} catch (error) {
			if (!signal.aborted) {
				showErrorToast({
					title: "Interrupt failed",
					message: "Could not interrupt this run.",
					detail: error instanceof Error ? error.message : null,
				})
			}
		} finally {
			if (interruption.current === controller) {
				interruption.current = null
				if (!accepted) setInterrupting(false)
			}
		}
	}

	return { canReply, replying, reply, canInterrupt, interrupting, interrupt }
}
