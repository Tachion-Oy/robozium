import { useEffect, useRef, useState } from "react"
import type { DesktopApiClient } from "../api/client"
import { withDeadline } from "../api/request"
import { submitReply, interruptRun } from "../run/run-api"
import { RunStatus } from "../run/run-contracts"
import { errorMessage } from "../run/run-updates"
import type { RunLifecycle } from "./useRunLifecycle"

export interface RunInteractions {
	replying: boolean
	canReply: boolean
	interrupting: boolean
	canInterrupt: boolean
	actionError: string
	reply: (content: string) => Promise<boolean>
	interrupt: () => Promise<void>
}

/** Execute acknowledged writes within the current run lifetime; never repeat a write automatically. */
export function useRunInteractions(client: DesktopApiClient | null, lifecycle: RunLifecycle): RunInteractions {
	const { session, scope, creating } = lifecycle
	const replyRequest = useRef<AbortController | null>(null)
	const interruptRequest = useRef<AbortController | null>(null)
	const [replying, setReplying] = useState(false)
	const [interrupting, setInterrupting] = useState(false)
	const [actionError, setActionError] = useState("")

	useEffect(() => {
		setReplying(false)
		setInterrupting(false)
		setActionError("")
		return () => {
			replyRequest.current?.abort()
			replyRequest.current = null
			interruptRequest.current?.abort()
			interruptRequest.current = null
		}
	}, [scope])

	const canReply = Boolean(session?.run.synchronized && session.run.status === RunStatus.AwaitingUserInput
		&& session.run.prompt && !session.run.error) && !creating && !replying

	async function reply(content: string): Promise<boolean> {
		const promptId = session?.run.prompt?.id
		if (!client || !session || !scope || scope.aborted || !canReply || !promptId || !content.trim()) return false
		if (replyRequest.current || lifecycle.isCreating()) return false

		const controller = new AbortController()
		const signal = AbortSignal.any([scope, controller.signal])
		replyRequest.current = controller
		setReplying(true)
		setActionError("")
		try {
			await withDeadline(signal, deadline => submitReply(client, session.run.runId, promptId, content.trim(), deadline))
			if (signal.aborted) return false
			lifecycle.dispatch({ type: "replied", promptId })
			return lifecycle.getSession()?.run.prompt?.id === promptId
		} catch (error) {
			if (!signal.aborted) {
				setActionError(errorMessage(error))
				lifecycle.dispatch({ type: "retry" })
			}
			return false
		} finally {
			if (!signal.aborted && replyRequest.current === controller) {
				replyRequest.current = null
				setReplying(false)
				lifecycle.refresh()
			}
		}
	}

	useEffect(() => {
		if (session?.run.synchronized && (session.run.prompt || session.run.status !== RunStatus.Running)) {
			setInterrupting(false)
		}
	}, [session?.run.synchronized, session?.run.prompt, session?.run.status])

	const canInterrupt = Boolean(session?.run.synchronized && session.run.status === RunStatus.Running && !session.run.prompt)
		&& !creating && !interrupting

	async function interrupt(): Promise<void> {
		if (!client || !session || !scope || scope.aborted || !canInterrupt) return
		if (interruptRequest.current || lifecycle.isCreating()) return

		const controller = new AbortController()
		const signal = AbortSignal.any([scope, controller.signal])
		interruptRequest.current = controller
		setInterrupting(true)
		setActionError("")
		try {
			const accepted = await withDeadline(signal, deadline => interruptRun(client, session.run.runId, deadline))
			if (!signal.aborted && !accepted) {
				setInterrupting(false)
				setActionError("Interruption was not accepted. Refreshing run status.")
			}
		} catch (error) {
			if (!signal.aborted) {
				setInterrupting(false)
				setActionError(errorMessage(error))
			}
		} finally {
			if (!signal.aborted && interruptRequest.current === controller) {
				interruptRequest.current = null
				lifecycle.refresh()
			}
		}
	}

	return { replying, canReply, interrupting, canInterrupt, actionError, reply, interrupt }
}
